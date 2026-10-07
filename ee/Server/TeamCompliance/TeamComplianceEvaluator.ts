import ComplianceRule, {
  COMPLIANCE_CHANNEL_DEFINITIONS,
  COMPLIANCE_RULE_DEFINITIONS,
  ComplianceChannelDefinition,
  ComplianceRuleCategory,
  ComplianceRuleDefinition,
  ComplianceSeverityKind,
  joinAsProse,
} from "Common/Types/Team/ComplianceRule";
import ComplianceNotificationChannel from "Common/Types/Team/ComplianceNotificationChannel";
import ComplianceRuleType from "Common/Types/Team/ComplianceRuleType";
import {
  TeamComplianceIssueJSON,
  TeamComplianceRuleJSON,
  TeamComplianceSeverityJSON,
  TeamComplianceStatusJSON,
  TeamMemberComplianceJSON,
} from "Common/Types/Team/TeamComplianceStatus";
import NotificationRuleType from "Common/Types/NotificationRule/NotificationRuleType";
import { getWhoCanTurnOnSentence } from "Common/Utils/Project/NotificationChannels";
import ObjectID from "Common/Types/ObjectID";

/*
 * The team compliance verdict, as PURE functions over data that has already
 * been loaded.
 *
 * TeamComplianceService does the reading - batched, tenant-scoped, as root -
 * and hands everything it read to `evaluate`, which decides who passes which
 * rule and builds the exact TeamComplianceStatusJSON the Dashboard renders.
 * Nothing in here touches a database, a clock or a cache, so every judgement
 * the page makes can be pinned by a unit test that just builds the inputs.
 *
 * WHAT "COMPLIANT" MEANS. A rule is about a member's CONFIGURATION: have they
 * set up what the rule asks for? Problems that are not the member's to fix -
 * the project has calls switched off, say - are reported once, as a warning on
 * the rule, and never as forty identical member failures.
 *
 * There are three kinds of rule:
 *
 *  - Method rules ("has a verified phone for calls"): the member owns a
 *    verified method on the channel in this project. Webhooks have no
 *    verification step, so any webhook counts.
 *
 *  - On-call rules with no channel ("has incident on-call rules"): answered
 *    from the on-call readiness coverage cells, exactly as the readiness pages
 *    answer it, so the two surfaces cannot disagree. A cell counts when the
 *    member has a rule for it OR has deliberately opted out of it.
 *
 *  - On-call rules WITH channels ("Call for Critical incidents", "Call and
 *    Push notification for Critical incidents"): for every severity in scope
 *    and on EVERY one of the rule's channels, the member has a rule of the
 *    right type for that severity that notifies them on that channel, through
 *    a method they own and have verified - so a rule on two channels checks
 *    exactly what two one-channel rules would. Readiness cannot answer this -
 *    its cells carry no channel - so the service reads the rules and the
 *    methods they point at, and the judgement is made here. An opt-out does
 *    NOT satisfy a channel rule: "they have asked never to be called for
 *    Critical" is precisely the thing a "Call for Critical" rule exists to
 *    catch.
 */

/*
 * The four "has a verified method" reasons that predate this module are kept
 * word for word: they are what existing installs have been showing admins.
 */
export const METHOD_RULE_FAILURE_REASONS: Readonly<
  Record<ComplianceNotificationChannel, string>
> = {
  [ComplianceNotificationChannel.Email]:
    "No verified email address configured for notifications",
  [ComplianceNotificationChannel.SMS]:
    "No verified phone number configured for SMS notifications",
  [ComplianceNotificationChannel.Call]:
    "No verified phone number configured for call notifications",
  [ComplianceNotificationChannel.Push]:
    "No verified push notification device configured",
  [ComplianceNotificationChannel.WhatsApp]:
    "No verified WhatsApp number configured for notifications",
  [ComplianceNotificationChannel.Telegram]:
    "No verified Telegram account configured for notifications",
  [ComplianceNotificationChannel.Slack]:
    "No verified Slack account configured for notifications",
  [ComplianceNotificationChannel.MicrosoftTeams]:
    "No verified Microsoft Teams account configured for notifications",
  [ComplianceNotificationChannel.Webhook]:
    "No webhook configured for notifications",
};

export const UNKNOWN_RULE_TYPE_WARNING: string =
  "This rule type is not recognised, so it is not checked.";

/*
 * Why a rule a severity delete left with nothing to check
 * (TeamComplianceSetting.options.severitiesDeleted) is paused. Given even
 * though the rule is disabled: it is the only thing on the page that says
 * the rule cannot simply be switched back on.
 */
export const SEVERITIES_DELETED_WARNING: string =
  "Every severity this rule was scoped to has been deleted, so it is paused. Edit it to choose new severities, or delete it.";

/*
 * The Project columns that switch a channel off for the whole project, and
 * so stop members meeting - or being paged by - a rule on it:
 *
 *  - Call, SMS and Telegram: CallService, SmsService and TelegramService
 *    refuse to SEND while theirs is off, so a member who meets a rule on that
 *    channel is still never notified by it.
 *  - WhatsApp: WhatsAppService still sends to numbers verified before the
 *    switch went off, but UserWhatsAppService refuses to ADD a number while
 *    it is off - and it is off by default - so a member without a number
 *    cannot meet the rule at all. Its warning says that instead
 *    (getChannelSwitchedOffWarning).
 *
 * Push, Email, Slack, Microsoft Teams and webhooks have no such switch.
 *
 * Only a project owner, a Billing Admin or someone with Manage Billing may
 * turn one on, and the people reading these warnings - whoever sees the
 * team's compliance - are often neither, so every warning says who can, and
 * where (Utils/Project/NotificationChannels), rather than telling the reader
 * to.
 */
export type ProjectChannelSwitch =
  | "enableCallNotifications"
  | "enableSmsNotifications"
  | "enableWhatsAppNotifications"
  | "enableTelegramNotifications";

export const PROJECT_CHANNEL_SWITCHES: Readonly<
  Partial<Record<ComplianceNotificationChannel, ProjectChannelSwitch>>
> = {
  [ComplianceNotificationChannel.Call]: "enableCallNotifications",
  [ComplianceNotificationChannel.SMS]: "enableSmsNotifications",
  [ComplianceNotificationChannel.WhatsApp]: "enableWhatsAppNotifications",
  [ComplianceNotificationChannel.Telegram]: "enableTelegramNotifications",
};

export const WHATSAPP_SWITCHED_OFF_WARNING: string = `WhatsApp is switched off for this project, so members cannot add a WhatsApp number to meet this rule. ${getWhoCanTurnOnSentence("it")}`;

// A severity, as a rule's selection or the project's severity list has it.
export interface ComplianceSeverityInput {
  id: string;
  name?: string | undefined;
  // Hex colour, when the severity has one.
  color?: string | undefined;
  // Lower is more severe.
  order?: number | undefined;
  /*
   * The project the severity belongs to. A selected severity from any other
   * project - or one whose project is unknown - is ignored.
   */
  projectId?: string | undefined;
}

// One TeamComplianceSetting row, as stored. Nothing here is trusted yet.
export interface ComplianceRuleInput {
  settingId: string;
  ruleType: string | undefined;
  enabled: boolean | undefined;
  /*
   * The channels the row holds, as read off its two channel columns
   * (TeamComplianceSettingService.getStoredChannels). Empty is "any channel".
   */
  notificationChannels: Array<string> | null | undefined;
  createdAt?: Date | undefined;
  incidentSeverities: Array<ComplianceSeverityInput>;
  alertSeverities: Array<ComplianceSeverityInput>;
  /*
   * The row's options.severitiesDeleted: a severity delete left the rule
   * with none of the severities it was scoped to, and paused it.
   */
  severitiesDeleted?: boolean | undefined;
}

// A team member who resolves to a user, in team-member order.
export interface ComplianceMemberInput {
  userId: string;
  name?: string | undefined;
  email?: string | undefined;
  profilePictureId?: string | undefined;
}

/*
 * One (ruleType, severity) cell of a member's on-call readiness coverage.
 * Structurally a ReadinessCoverageCell, restated here so this module does not
 * import the readiness service.
 */
export interface ComplianceCoverageCellInput {
  ruleType: NotificationRuleType | string;
  severityId?: ObjectID | string | undefined;
  severityName?: string | undefined;
  hasRule: boolean;
  isOptOut: boolean;
}

// One UserNotificationRule row of a team member.
export interface ComplianceNotificationRuleInput {
  userId: string;
  ruleType: NotificationRuleType | string;
  incidentSeverityId?: string | undefined;
  alertSeverityId?: string | undefined;
  // True only for a stored `isOptOut === true`. NULL on legacy rows is a rule.
  isOptOut: boolean;
  // The method id in each channel column that is set on the row.
  methodIds: Partial<Record<ComplianceNotificationChannel, string>>;
  /*
   * True when ANY of the row's nine method relations - not only the channel
   * being judged - points at a method row that exists and belongs to another
   * user. The runtime refuses such a rule outright and sends nothing on any
   * channel (UserNotificationRuleService.executeNotificationRuleItem, through
   * getNotificationMethodsNotOwnedByRuleOwner), so it covers nothing here.
   */
  hasForeignMethod?: boolean | undefined;
}

// A notification method row a rule points at.
export interface ComplianceMethodInput {
  methodId: string;
  userId: string | undefined;
  // Webhooks have no verification step; pass true for them.
  isVerified: boolean;
}

export interface TeamComplianceEvaluationInput {
  teamId: string;
  teamName: string | undefined;
  projectId: string;
  evaluatedAt: Date;
  rules: Array<ComplianceRuleInput>;
  members: Array<ComplianceMemberInput>;
  /*
   * Readiness coverage per member id. Consulted only for enabled on-call
   * rules with no channel; a member missing from it could not be checked.
   */
  coverageByUserId: ReadonlyMap<string, Array<ComplianceCoverageCellInput>>;
  /*
   * For each channel an enabled method rule checks: the ids of members who own
   * a verified method on it (any method at all, for webhooks).
   */
  verifiedMethodOwnersByChannel: ReadonlyMap<
    ComplianceNotificationChannel,
    ReadonlySet<string>
  >;
  /*
   * The project's severities of each kind a channel rule needs, most severe
   * first. A channel rule with no severities selected checks all of them.
   */
  projectSeveritiesByKind: ReadonlyMap<
    ComplianceSeverityKind,
    Array<ComplianceSeverityInput>
  >;
  // The team members' notification rules of the types channel rules check.
  notificationRules: Array<ComplianceNotificationRuleInput>;
  // For each channel a channel rule checks: the method rows rules point at.
  methodsByChannel: ReadonlyMap<
    ComplianceNotificationChannel,
    ReadonlyMap<string, ComplianceMethodInput>
  >;
  /*
   * The project's channel switches, or null when no enabled rule relies on a
   * switched channel (and so the project was not read). A switch missing
   * from a record that WAS read is off - that is what a project row that could
   * not be read looks like, and "off" is the answer that gets it looked at.
   */
  projectSwitches: Partial<Record<ProjectChannelSwitch, boolean>> | null;
}

// A rule once its stored fields have been checked against the catalog.
export interface ResolvedComplianceRule {
  settingId: string;
  // The stored rule type, whether or not this server recognises it.
  ruleType: string;
  enabled: boolean;
  // Undefined for a rule type this server does not recognise.
  definition: ComplianceRuleDefinition | undefined;
  /*
   * The channels an on-call rule insists on, each once, in catalog order. A
   * member needs a rule on every one of them. Empty means "any channel", and
   * is always empty for method rules and unrecognised rules.
   */
  notificationChannels: Array<ComplianceNotificationChannel>;
  severityKind: ComplianceSeverityKind | null;
  /*
   * The rule's selected severities of its own kind that belong to the
   * project, most severe first. Empty means every severity of that kind.
   */
  severities: Array<ComplianceSeverityInput>;
  /*
   * A severity delete left this on-call rule with none of the severities it
   * was scoped to: it checks nothing - it does NOT apply to every severity -
   * until an admin picks new ones. Never set on a rule that has severities.
   */
  severitiesDeleted: boolean;
  createdAt: Date | undefined;
}

// What the service has to read to evaluate a set of rules.
export interface ComplianceLoadPlan {
  // An enabled on-call rule with no channel needs readiness coverage.
  needsCoverage: boolean;
  // Channels enabled method rules check, in catalog order.
  methodChannels: Array<ComplianceNotificationChannel>;
  // Channels enabled on-call rules insist on, in catalog order.
  onCallChannels: Array<ComplianceNotificationChannel>;
  // The notification rule types those channel rules check.
  onCallRuleTypes: Array<NotificationRuleType>;
  // The severity kinds whose project list those channel rules need.
  onCallSeverityKinds: Array<ComplianceSeverityKind>;
  // Project switches gating a channel an enabled rule relies on.
  projectSwitches: Array<ProjectChannelSwitch>;
}

/*
 * The severity column each paging rule type is addressed by: incident and
 * incident-episode rules by incidentSeverityId, alert and alert-episode rules
 * by alertSeverityId. A value in the OTHER column is ignored - an incident
 * rule that happens to carry an alert severity id covers no alert severity.
 */
const SEVERITY_KIND_BY_NOTIFICATION_RULE_TYPE: ReadonlyMap<
  string,
  ComplianceSeverityKind
> = new Map<string, ComplianceSeverityKind>(
  COMPLIANCE_RULE_DEFINITIONS.filter(
    (definition: ComplianceRuleDefinition): boolean => {
      return Boolean(
        definition.notificationRuleType && definition.severityKind,
      );
    },
  ).map(
    (
      definition: ComplianceRuleDefinition,
    ): [string, ComplianceSeverityKind] => {
      return [definition.notificationRuleType!, definition.severityKind!];
    },
  ),
);

const SEVERITY_KIND_ORDER: Array<ComplianceSeverityKind> = [
  ComplianceSeverityKind.Incident,
  ComplianceSeverityKind.Alert,
];

interface RuleOutcome {
  compliantCount: number;
  nonCompliantCount: number;
}

// What one channel rule needs, worked out once rather than once per member.
interface ChannelRuleContext {
  // In catalog order; never empty.
  channels: Array<ComplianceChannelDefinition>;
  notificationRuleType: NotificationRuleType;
  subject: string;
  scope: Array<ComplianceSeverityInput>;
}

/*
 * Why a member is not covered on one of a channel rule's channels: the names
 * of the severities in scope under each heading, and the ids of those opted
 * out of (said once for the rule, not once per channel).
 */
interface ChannelVerdict {
  missing: Array<string>;
  unverified: Array<string>;
  refused: Array<string>;
  optedOutSeverityIds: Array<string>;
}

interface EvaluationContext {
  input: TeamComplianceEvaluationInput;
  rulesByCoverageKey: ReadonlyMap<
    string,
    Array<ComplianceNotificationRuleInput>
  >;
  channelRuleContexts: ReadonlyMap<ResolvedComplianceRule, ChannelRuleContext>;
  // The selected severity ids of each scoped rule, built once for all members.
  severityScopes: ReadonlyMap<ResolvedComplianceRule, ReadonlySet<string>>;
}

export default class TeamComplianceEvaluator {
  /*
   * The team's rules as the page lists them - oldest first, so a rule does not
   * move when another is added - with every stored field checked against the
   * catalog: options the rule type does not take are dropped, and so are
   * selected severities of another kind or another project.
   */
  public static resolveRules(
    rules: Array<ComplianceRuleInput>,
    projectId: string,
  ): Array<ResolvedComplianceRule> {
    const resolved: Array<ResolvedComplianceRule> = rules.map(
      (rule: ComplianceRuleInput): ResolvedComplianceRule => {
        return TeamComplianceEvaluator.resolveRule(rule, projectId);
      },
    );

    return TeamComplianceEvaluator.stableSort(
      resolved,
      (a: ResolvedComplianceRule, b: ResolvedComplianceRule): number => {
        return (
          TeamComplianceEvaluator.compareCreatedAt(a.createdAt, b.createdAt) ||
          TeamComplianceEvaluator.compareStrings(a.settingId, b.settingId)
        );
      },
    );
  }

  /*
   * Whether members are checked against the rule: it is enabled, of a type
   * this server recognises, and has not lost its severities to a delete.
   */
  public static isChecked(rule: ResolvedComplianceRule): boolean {
    return rule.enabled && Boolean(rule.definition) && !rule.severitiesDeleted;
  }

  /*
   * Exactly what has to be read for these rules, and nothing more: a team that
   * only checks "has a verified email" must not pay for a readiness pass, a
   * rule read or a project read on every render. Rules that are not checked
   * (disabled, unrecognised, or left without severities) cost nothing either.
   */
  public static planLoads(
    rules: Array<ResolvedComplianceRule>,
  ): ComplianceLoadPlan {
    const active: Array<ResolvedComplianceRule> = rules.filter(
      (rule: ResolvedComplianceRule): boolean => {
        return TeamComplianceEvaluator.isChecked(rule);
      },
    );

    const methodChannels: Set<ComplianceNotificationChannel> =
      new Set<ComplianceNotificationChannel>();
    const onCallChannels: Set<ComplianceNotificationChannel> =
      new Set<ComplianceNotificationChannel>();
    const onCallRuleTypes: Set<NotificationRuleType> =
      new Set<NotificationRuleType>();
    const onCallSeverityKinds: Set<ComplianceSeverityKind> =
      new Set<ComplianceSeverityKind>();
    const switchedChannels: Set<ComplianceNotificationChannel> =
      new Set<ComplianceNotificationChannel>();
    let needsCoverage: boolean = false;

    for (const rule of active) {
      const definition: ComplianceRuleDefinition = rule.definition!;

      if (definition.category === ComplianceRuleCategory.NotificationMethod) {
        if (definition.methodChannel) {
          methodChannels.add(definition.methodChannel);
          switchedChannels.add(definition.methodChannel);
        }
        continue;
      }

      if (rule.notificationChannels.length === 0) {
        needsCoverage = true;
        continue;
      }

      for (const channel of rule.notificationChannels) {
        onCallChannels.add(channel);
        switchedChannels.add(channel);
      }

      if (definition.notificationRuleType) {
        onCallRuleTypes.add(definition.notificationRuleType);
      }

      if (definition.severityKind) {
        onCallSeverityKinds.add(definition.severityKind);
      }
    }

    const inChannelOrder: (
      channels: Set<ComplianceNotificationChannel>,
    ) => Array<ComplianceNotificationChannel> = (
      channels: Set<ComplianceNotificationChannel>,
    ): Array<ComplianceNotificationChannel> => {
      return COMPLIANCE_CHANNEL_DEFINITIONS.map(
        (
          definition: ComplianceChannelDefinition,
        ): ComplianceNotificationChannel => {
          return definition.channel;
        },
      ).filter((channel: ComplianceNotificationChannel): boolean => {
        return channels.has(channel);
      });
    };

    const projectSwitches: Array<ProjectChannelSwitch> = [];

    for (const channel of inChannelOrder(switchedChannels)) {
      const projectSwitch: ProjectChannelSwitch | undefined =
        PROJECT_CHANNEL_SWITCHES[channel];

      if (projectSwitch) {
        projectSwitches.push(projectSwitch);
      }
    }

    return {
      needsCoverage: needsCoverage,
      methodChannels: inChannelOrder(methodChannels),
      onCallChannels: inChannelOrder(onCallChannels),
      onCallRuleTypes: COMPLIANCE_RULE_DEFINITIONS.map(
        (
          definition: ComplianceRuleDefinition,
        ): NotificationRuleType | undefined => {
          return definition.notificationRuleType;
        },
      ).filter(
        (
          ruleType: NotificationRuleType | undefined,
        ): ruleType is NotificationRuleType => {
          return ruleType !== undefined && onCallRuleTypes.has(ruleType);
        },
      ),
      onCallSeverityKinds: SEVERITY_KIND_ORDER.filter(
        (kind: ComplianceSeverityKind): boolean => {
          return onCallSeverityKinds.has(kind);
        },
      ),
      projectSwitches: projectSwitches,
    };
  }

  // The whole page: every rule, every member, and each member's failures.
  public static evaluate(
    input: TeamComplianceEvaluationInput,
  ): TeamComplianceStatusJSON {
    const rules: Array<ResolvedComplianceRule> =
      TeamComplianceEvaluator.resolveRules(input.rules, input.projectId);

    const channelRuleContexts: Map<ResolvedComplianceRule, ChannelRuleContext> =
      new Map<ResolvedComplianceRule, ChannelRuleContext>();
    const severityScopes: Map<
      ResolvedComplianceRule,
      ReadonlySet<string>
    > = new Map<ResolvedComplianceRule, ReadonlySet<string>>();

    for (const rule of rules) {
      const context: ChannelRuleContext | undefined =
        TeamComplianceEvaluator.getChannelRuleContext(rule, input);

      if (context) {
        channelRuleContexts.set(rule, context);
      }

      if (rule.severities.length > 0) {
        severityScopes.set(
          rule,
          new Set<string>(
            rule.severities.map((severity: ComplianceSeverityInput): string => {
              return severity.id;
            }),
          ),
        );
      }
    }

    const context: EvaluationContext = {
      input: input,
      rulesByCoverageKey: TeamComplianceEvaluator.indexNotificationRules(
        input.notificationRules,
      ),
      channelRuleContexts: channelRuleContexts,
      severityScopes: severityScopes,
    };

    const outcomes: Array<RuleOutcome> = rules.map((): RuleOutcome => {
      return { compliantCount: 0, nonCompliantCount: 0 };
    });

    const userComplianceStatuses: Array<TeamMemberComplianceJSON> = [];

    for (const member of TeamComplianceEvaluator.uniqueMembers(input.members)) {
      const issues: Array<TeamComplianceIssueJSON> = [];

      rules.forEach((rule: ResolvedComplianceRule, index: number): void => {
        if (!TeamComplianceEvaluator.isChecked(rule)) {
          return;
        }

        const reason: string | null = TeamComplianceEvaluator.evaluateRule(
          rule,
          member.userId,
          context,
        );

        const outcome: RuleOutcome = outcomes[index]!;

        if (reason === null) {
          outcome.compliantCount++;
          return;
        }

        outcome.nonCompliantCount++;
        issues.push({
          settingId: rule.settingId,
          ruleType: rule.ruleType as ComplianceRuleType,
          reason: reason,
        });
      });

      userComplianceStatuses.push({
        userId: member.userId,
        userName: member.name || member.email || "Unknown User",
        userEmail: member.email || "",
        ...(member.profilePictureId
          ? { userProfilePictureId: member.profilePictureId }
          : {}),
        isCompliant: issues.length === 0,
        nonCompliantRules: issues,
      });
    }

    return {
      teamId: input.teamId,
      teamName: input.teamName || "Unknown Team",
      evaluatedAt: input.evaluatedAt.toISOString(),
      complianceSettings: rules.map(
        (
          rule: ResolvedComplianceRule,
          index: number,
        ): TeamComplianceRuleJSON => {
          return TeamComplianceEvaluator.toRuleJSON(
            rule,
            outcomes[index]!,
            input.projectSwitches,
          );
        },
      ),
      userComplianceStatuses: userComplianceStatuses,
    };
  }

  /*
   * What is wrong with the rule itself rather than with any member. Only
   * checked rules are checked for a switched-off channel - a paused rule
   * warns about nothing - but an unrecognised rule, and one whose severities
   * were all deleted, always say so, enabled or not: otherwise nothing on the
   * page explains why it is never checked, or that switching it back on is
   * not the fix.
   */
  public static getRuleWarnings(
    rule: ResolvedComplianceRule,
    projectSwitches: Partial<Record<ProjectChannelSwitch, boolean>> | null,
  ): Array<string> {
    if (!rule.definition) {
      return [UNKNOWN_RULE_TYPE_WARNING];
    }

    if (rule.severitiesDeleted) {
      return [SEVERITIES_DELETED_WARNING];
    }

    if (!rule.enabled || !projectSwitches) {
      return [];
    }

    const channels: Array<ComplianceNotificationChannel> =
      rule.definition.category === ComplianceRuleCategory.NotificationMethod
        ? rule.definition.methodChannel
          ? [rule.definition.methodChannel]
          : []
        : rule.notificationChannels;

    return TeamComplianceEvaluator.getChannelsSwitchedOffWarnings(
      channels.filter((channel: ComplianceNotificationChannel): boolean => {
        const projectSwitch: ProjectChannelSwitch | undefined =
          PROJECT_CHANNEL_SWITCHES[channel];

        return (
          projectSwitch !== undefined && projectSwitches[projectSwitch] !== true
        );
      }),
    );
  }

  /*
   * What the channel's project switch being off does to the rule - see
   * PROJECT_CHANNEL_SWITCHES: WhatsApp stops members adding a number, the
   * others stop pages being sent.
   */
  public static getChannelSwitchedOffWarning(
    channel: ComplianceNotificationChannel,
  ): string {
    if (channel === ComplianceNotificationChannel.WhatsApp) {
      return WHATSAPP_SWITCHED_OFF_WARNING;
    }

    const label: string = TeamComplianceEvaluator.channelLabel(channel);

    return `${label} notifications are switched off for this project, so members will not be notified by ${label} even when they meet this rule. ${getWhoCanTurnOnSentence("them")}`;
  }

  /*
   * The warnings for a rule whose `channels` are switched off for the
   * project, named in catalog order whatever order they arrive in. Channels
   * whose pages are not SENT are said in one sentence, not one each, so a
   * rule on Call and SMS does not repeat itself; WhatsApp, where the problem
   * is that nobody can ADD a number, keeps its own.
   */
  public static getChannelsSwitchedOffWarnings(
    channels: Array<ComplianceNotificationChannel>,
  ): Array<string> {
    const switchedOff: Array<ComplianceNotificationChannel> =
      ComplianceRule.normaliseChannels(channels);

    const notSent: Array<ComplianceNotificationChannel> = switchedOff.filter(
      (channel: ComplianceNotificationChannel): boolean => {
        return channel !== ComplianceNotificationChannel.WhatsApp;
      },
    );

    const warnings: Array<string> = [];

    if (notSent.length === 1) {
      warnings.push(
        TeamComplianceEvaluator.getChannelSwitchedOffWarning(notSent[0]!),
      );
    } else if (notSent.length > 1) {
      warnings.push(
        `${joinAsProse(
          notSent.map((channel: ComplianceNotificationChannel): string => {
            return TeamComplianceEvaluator.channelLabel(channel);
          }),
        )} notifications are switched off for this project, so members will not be notified on these channels even when they meet this rule. ${getWhoCanTurnOnSentence("them")}`,
      );
    }

    if (switchedOff.includes(ComplianceNotificationChannel.WhatsApp)) {
      warnings.push(WHATSAPP_SWITCHED_OFF_WARNING);
    }

    return warnings;
  }

  private static resolveRule(
    rule: ComplianceRuleInput,
    projectId: string,
  ): ResolvedComplianceRule {
    const definition: ComplianceRuleDefinition | undefined =
      ComplianceRule.getDefinition(rule.ruleType);

    const severityKind: ComplianceSeverityKind | null =
      definition?.severityKind || null;

    /*
     * The same normalisation TeamComplianceSettingService applies on write,
     * repeated on read because the database can hold rows written before it
     * existed: channels only mean something on an on-call rule, a value that
     * is not a channel is dropped, and a list with none left reads as "any
     * channel".
     */
    const notificationChannels: Array<ComplianceNotificationChannel> =
      definition && ComplianceRule.supportsChannel(definition.ruleType)
        ? ComplianceRule.normaliseChannels(rule.notificationChannels)
        : [];

    let severities: Array<ComplianceSeverityInput> = [];

    if (severityKind === ComplianceSeverityKind.Incident) {
      severities = TeamComplianceEvaluator.projectSeveritiesOnly(
        rule.incidentSeverities,
        projectId,
      );
    } else if (severityKind === ComplianceSeverityKind.Alert) {
      severities = TeamComplianceEvaluator.projectSeveritiesOnly(
        rule.alertSeverities,
        projectId,
      );
    }

    return {
      settingId: rule.settingId,
      ruleType: rule.ruleType || "",
      enabled: rule.enabled === true,
      definition: definition,
      notificationChannels: notificationChannels,
      severityKind: severityKind,
      severities: severities,
      /*
       * Only on a rule scoped by severity that has none left: a mark on a
       * rule that has severities again is stale, and the rule is judged by
       * what it has.
       */
      severitiesDeleted:
        rule.severitiesDeleted === true &&
        severityKind !== null &&
        severities.length === 0,
      createdAt: rule.createdAt,
    };
  }

  /*
   * A selected severity is honoured only if it provably belongs to this
   * project. The status is read as root, so a foreign id that slipped into the
   * relation would otherwise have its name printed on this project's page.
   */
  private static projectSeveritiesOnly(
    severities: Array<ComplianceSeverityInput>,
    projectId: string,
  ): Array<ComplianceSeverityInput> {
    const seen: Set<string> = new Set<string>();

    const own: Array<ComplianceSeverityInput> = severities.filter(
      (severity: ComplianceSeverityInput): boolean => {
        if (
          !severity.id ||
          severity.projectId !== projectId ||
          seen.has(severity.id)
        ) {
          return false;
        }

        seen.add(severity.id);
        return true;
      },
    );

    return TeamComplianceEvaluator.sortBySeverityOrder(own);
  }

  // Most severe (lowest order) first; a severity with no order goes last.
  private static sortBySeverityOrder(
    severities: Array<ComplianceSeverityInput>,
  ): Array<ComplianceSeverityInput> {
    return TeamComplianceEvaluator.stableSort(
      severities,
      (a: ComplianceSeverityInput, b: ComplianceSeverityInput): number => {
        const aOrder: number =
          typeof a.order === "number" ? a.order : Number.POSITIVE_INFINITY;
        const bOrder: number =
          typeof b.order === "number" ? b.order : Number.POSITIVE_INFINITY;

        if (aOrder === bOrder) {
          return 0;
        }

        return aOrder < bOrder ? -1 : 1;
      },
    );
  }

  // A sort that keeps the input order of items that compare equal.
  private static stableSort<T>(
    items: Array<T>,
    compare: (a: T, b: T) => number,
  ): Array<T> {
    return items
      .map((item: T, index: number): { item: T; index: number } => {
        return { item: item, index: index };
      })
      .sort(
        (
          a: { item: T; index: number },
          b: { item: T; index: number },
        ): number => {
          return compare(a.item, b.item) || a.index - b.index;
        },
      )
      .map((entry: { item: T; index: number }): T => {
        return entry.item;
      });
  }

  // Oldest first; a row with no timestamp sorts after every row with one.
  private static compareCreatedAt(
    a: Date | undefined,
    b: Date | undefined,
  ): number {
    const aTime: number =
      a instanceof Date && !isNaN(a.getTime())
        ? a.getTime()
        : Number.POSITIVE_INFINITY;
    const bTime: number =
      b instanceof Date && !isNaN(b.getTime())
        ? b.getTime()
        : Number.POSITIVE_INFINITY;

    if (aTime === bTime) {
      return 0;
    }

    return aTime < bTime ? -1 : 1;
  }

  private static compareStrings(a: string, b: string): number {
    if (a === b) {
      return 0;
    }

    return a < b ? -1 : 1;
  }

  // One row per user, in team-member order, whatever the membership table says.
  private static uniqueMembers(
    members: Array<ComplianceMemberInput>,
  ): Array<ComplianceMemberInput> {
    const seen: Set<string> = new Set<string>();

    return members.filter((member: ComplianceMemberInput): boolean => {
      if (!member.userId || seen.has(member.userId)) {
        return false;
      }

      seen.add(member.userId);
      return true;
    });
  }

  // Null when the member passes the rule; otherwise why they do not.
  private static evaluateRule(
    rule: ResolvedComplianceRule,
    userId: string,
    context: EvaluationContext,
  ): string | null {
    const definition: ComplianceRuleDefinition = rule.definition!;

    if (definition.category === ComplianceRuleCategory.NotificationMethod) {
      const channel: ComplianceNotificationChannel = definition.methodChannel!;

      const owners: ReadonlySet<string> | undefined =
        context.input.verifiedMethodOwnersByChannel.get(channel);

      return owners && owners.has(userId)
        ? null
        : METHOD_RULE_FAILURE_REASONS[channel];
    }

    const channelRule: ChannelRuleContext | undefined =
      context.channelRuleContexts.get(rule);

    if (channelRule) {
      return TeamComplianceEvaluator.evaluateChannelRule(
        channelRule,
        userId,
        context,
      );
    }

    return TeamComplianceEvaluator.evaluateCoverageRule(rule, userId, context);
  }

  /*
   * An on-call rule with no channel, answered from readiness coverage cells:
   * the cells of the rule's notification rule type (and, when the rule is
   * scoped, of its severities) must each be covered or opted out of.
   *
   * No readiness for the member is its own answer, and deliberately not a
   * pass: the batch omits a member it cannot resolve - usually somebody
   * removed from the project a moment ago - and "we could not check" must
   * never render as the same green as "we checked and it is fine".
   */
  private static evaluateCoverageRule(
    rule: ResolvedComplianceRule,
    userId: string,
    context: EvaluationContext,
  ): string | null {
    const definition: ComplianceRuleDefinition = rule.definition!;
    const subject: string = definition.subject || "";

    const coverage: Array<ComplianceCoverageCellInput> | undefined =
      context.input.coverageByUserId.get(userId);

    if (!coverage) {
      return `Could not check ${subject} notification rules for this user - they may no longer be a member of this project`;
    }

    // Undefined when the rule is not scoped: every severity counts.
    const scope: ReadonlySet<string> | undefined =
      context.severityScopes.get(rule);

    const missing: Array<string> = coverage
      .filter((cell: ComplianceCoverageCellInput): boolean => {
        if (cell.ruleType !== definition.notificationRuleType) {
          return false;
        }

        if (
          scope &&
          !(cell.severityId && scope.has(cell.severityId.toString()))
        ) {
          return false;
        }

        return !cell.hasRule && !cell.isOptOut;
      })
      .map((cell: ComplianceCoverageCellInput): string => {
        return cell.severityName || cell.severityId?.toString() || "";
      });

    if (missing.length === 0) {
      return null;
    }

    return `Missing notification rules for ${subject} severities: ${missing.join(", ")}`;
  }

  private static getChannelRuleContext(
    rule: ResolvedComplianceRule,
    input: TeamComplianceEvaluationInput,
  ): ChannelRuleContext | undefined {
    const definition: ComplianceRuleDefinition | undefined = rule.definition;

    if (
      !TeamComplianceEvaluator.isChecked(rule) ||
      !definition ||
      definition.category !== ComplianceRuleCategory.OnCallRule ||
      !definition.notificationRuleType ||
      !definition.severityKind
    ) {
      return undefined;
    }

    const channels: Array<ComplianceChannelDefinition> = [];

    for (const channel of rule.notificationChannels) {
      const channelDefinition: ComplianceChannelDefinition | undefined =
        ComplianceRule.getChannelDefinition(channel);

      if (channelDefinition) {
        channels.push(channelDefinition);
      }
    }

    if (channels.length === 0) {
      return undefined;
    }

    const projectSeverities: Array<ComplianceSeverityInput> =
      TeamComplianceEvaluator.sortBySeverityOrder(
        input.projectSeveritiesByKind.get(definition.severityKind) || [],
      );

    /*
     * The selection, as the project's severity list has it (so in the
     * project's order and with its current names), or the whole list when
     * nothing is selected.
     */
    let scope: Array<ComplianceSeverityInput> = projectSeverities;

    if (rule.severities.length > 0) {
      const selected: Set<string> = new Set<string>(
        rule.severities.map((severity: ComplianceSeverityInput): string => {
          return severity.id;
        }),
      );

      scope = projectSeverities.filter(
        (severity: ComplianceSeverityInput): boolean => {
          return selected.has(severity.id);
        },
      );
    }

    return {
      channels: channels,
      notificationRuleType: definition.notificationRuleType,
      subject: definition.subject || "",
      scope: scope,
    };
  }

  /*
   * An on-call rule with channels, judged one channel at a time - a rule on
   * Call and Push is met only when the member meets it on Call AND on Push,
   * exactly as if it were two rules. What is wrong on each channel is said
   * channel by channel, in catalog order (see judgeChannel); an opt-out is
   * about the severity rather than any one channel, so it is said once, after
   * them all, in scope order.
   */
  private static evaluateChannelRule(
    rule: ChannelRuleContext,
    userId: string,
    context: EvaluationContext,
  ): string | null {
    const sentences: Array<string> = [];
    const optedOutSeverityIds: Set<string> = new Set<string>();

    for (const channel of rule.channels) {
      const verdict: ChannelVerdict = TeamComplianceEvaluator.judgeChannel(
        rule,
        channel,
        userId,
        context,
      );

      if (verdict.missing.length > 0) {
        sentences.push(
          `No ${channel.label} rule for ${rule.subject} severities: ${verdict.missing.join(", ")}`,
        );
      }

      if (verdict.unverified.length > 0) {
        sentences.push(
          `The ${channel.label} rule for ${rule.subject} severities ${verdict.unverified.join(", ")} points at an unverified ${channel.methodNoun}`,
        );
      }

      if (verdict.refused.length > 0) {
        sentences.push(
          `The ${channel.label} rule for ${rule.subject} severities ${verdict.refused.join(", ")} is never sent, because another notification method on it belongs to a different user`,
        );
      }

      for (const severityId of verdict.optedOutSeverityIds) {
        optedOutSeverityIds.add(severityId);
      }
    }

    const optedOut: Array<string> = rule.scope
      .filter((severity: ComplianceSeverityInput): boolean => {
        return optedOutSeverityIds.has(severity.id);
      })
      .map((severity: ComplianceSeverityInput): string => {
        return severity.name || severity.id;
      });

    if (optedOut.length > 0) {
      sentences.push(
        `Opted out of ${rule.subject} notifications for: ${optedOut.join(", ")}`,
      );
    }

    return sentences.length > 0 ? sentences.join(". ") : null;
  }

  /*
   * One channel of a channel rule. For each severity in scope the member
   * needs a rule of the right type, for that severity, that is not an opt-out
   * and notifies them on the channel through a method row that exists in this
   * project, belongs to them and is verified (webhooks have no verification).
   * The runtime skips an unverified method, and refuses a rule outright -
   * every channel of it - when ANY method on it belongs to somebody else, so
   * none of those is coverage here either.
   *
   * A severity that is not covered is reported under the most useful of four
   * headings - the member has a broken rule for it (fix the method), a rule
   * the runtime refuses because another of its methods is somebody else's
   * (fix the rule), has opted out of it (undo that), or has nothing (add a
   * rule) - in scope order.
   */
  private static judgeChannel(
    rule: ChannelRuleContext,
    channel: ComplianceChannelDefinition,
    userId: string,
    context: EvaluationContext,
  ): ChannelVerdict {
    const methods: ReadonlyMap<string, ComplianceMethodInput> =
      context.input.methodsByChannel.get(channel.channel) ||
      new Map<string, ComplianceMethodInput>();

    const verdict: ChannelVerdict = {
      missing: [],
      unverified: [],
      refused: [],
      optedOutSeverityIds: [],
    };

    for (const severity of rule.scope) {
      const rows: Array<ComplianceNotificationRuleInput> =
        context.rulesByCoverageKey.get(
          TeamComplianceEvaluator.coverageKey(
            userId,
            rule.notificationRuleType,
            severity.id,
          ),
        ) || [];

      let isCovered: boolean = false;
      let hasBrokenRule: boolean = false;
      let hasRefusedRule: boolean = false;
      let hasOptOut: boolean = false;

      for (const row of rows) {
        if (row.isOptOut) {
          hasOptOut = true;
          continue;
        }

        const methodId: string | undefined = row.methodIds[channel.channel];

        if (!methodId) {
          continue;
        }

        const method: ComplianceMethodInput | undefined = methods.get(methodId);

        if (
          method &&
          method.userId === userId &&
          (!channel.hasVerification || method.isVerified)
        ) {
          if (!row.hasForeignMethod) {
            isCovered = true;
            break;
          }

          // Right method, but the runtime refuses the rule it is on.
          hasRefusedRule = true;
          continue;
        }

        /*
         * A webhook cannot be "unverified", so a webhook rule that points at
         * nothing usable is simply not a webhook rule.
         */
        if (channel.hasVerification) {
          hasBrokenRule = true;
        }
      }

      if (isCovered) {
        continue;
      }

      const name: string = severity.name || severity.id;

      if (hasBrokenRule) {
        verdict.unverified.push(name);
      } else if (hasRefusedRule) {
        verdict.refused.push(name);
      } else if (hasOptOut) {
        verdict.optedOutSeverityIds.push(severity.id);
      } else {
        verdict.missing.push(name);
      }
    }

    return verdict;
  }

  /*
   * The members' rules keyed by (user, rule type, severity), taking the
   * severity from the column the rule type dictates. Rows of any other rule
   * type, or with no severity in that column, cover nothing and are dropped.
   */
  private static indexNotificationRules(
    rules: Array<ComplianceNotificationRuleInput>,
  ): Map<string, Array<ComplianceNotificationRuleInput>> {
    const index: Map<string, Array<ComplianceNotificationRuleInput>> = new Map<
      string,
      Array<ComplianceNotificationRuleInput>
    >();

    for (const rule of rules) {
      const kind: ComplianceSeverityKind | undefined =
        SEVERITY_KIND_BY_NOTIFICATION_RULE_TYPE.get(rule.ruleType);

      if (!kind || !rule.userId) {
        continue;
      }

      const severityId: string | undefined =
        kind === ComplianceSeverityKind.Incident
          ? rule.incidentSeverityId
          : rule.alertSeverityId;

      if (!severityId) {
        continue;
      }

      const key: string = TeamComplianceEvaluator.coverageKey(
        rule.userId,
        rule.ruleType,
        severityId,
      );

      const rows: Array<ComplianceNotificationRuleInput> = index.get(key) || [];
      rows.push(rule);
      index.set(key, rows);
    }

    return index;
  }

  // Pipe-separated: none of a uuid, a rule type or a uuid contains a pipe.
  private static coverageKey(
    userId: string,
    ruleType: string,
    severityId: string,
  ): string {
    return `${userId}|${ruleType}|${severityId}`;
  }

  private static toRuleJSON(
    rule: ResolvedComplianceRule,
    outcome: RuleOutcome,
    projectSwitches: Partial<Record<ProjectChannelSwitch, boolean>> | null,
  ): TeamComplianceRuleJSON {
    const isEvaluated: boolean = TeamComplianceEvaluator.isChecked(rule);

    return {
      settingId: rule.settingId,
      ruleType: rule.ruleType as ComplianceRuleType,
      enabled: rule.enabled,
      notificationChannels: rule.notificationChannels,
      severityKind: rule.severityKind,
      // A rule left without severities applies to none, not to all.
      appliesToAllSeverities:
        rule.severityKind !== null &&
        rule.severities.length === 0 &&
        !rule.severitiesDeleted,
      severities: rule.severities.map(
        (severity: ComplianceSeverityInput): TeamComplianceSeverityJSON => {
          return {
            id: severity.id,
            name: severity.name || severity.id,
            ...(severity.color ? { color: severity.color } : {}),
          };
        },
      ),
      compliantCount: isEvaluated ? outcome.compliantCount : 0,
      nonCompliantCount: isEvaluated ? outcome.nonCompliantCount : 0,
      warnings: TeamComplianceEvaluator.getRuleWarnings(rule, projectSwitches),
    };
  }

  private static channelLabel(channel: ComplianceNotificationChannel): string {
    return ComplianceRule.getChannelDefinition(channel)?.label || channel;
  }
}

import {
  AI_ACTION_CARD_FACTS,
  AI_ACTION_CARD_KINDS,
  AI_READ_CARD_COUNTED,
  AI_READ_CARD_ENTITY,
  AI_READ_CARD_FACTS,
  AI_READ_CARD_KINDS,
  AI_READ_CARD_LINES,
  AI_READ_CARD_NAME,
  AI_READ_CARD_NOUNS,
  AI_READ_CARD_PLURAL_SENTENCES,
  AI_READ_CARD_SENTENCES,
  AI_READ_CARD_SLO_STATUSES,
  AI_READ_CARD_VALUES,
  AIActionCardFact,
  AIActionCardValue,
  AIActionCardWords,
  AIActionSentence,
  AIActionSentenceValue,
  aiActionCardFact,
  aiActionFigure,
  aiActionList,
  aiActionMoment,
  aiActionPluralSentence,
  aiActionResourceByName,
  aiActionSentence,
  aiActionTerm,
} from "../../../../Types/AI/AIActionWords";
import {
  MonitorTypeHelper,
  MonitorTypeProps,
} from "../../../../Types/Monitor/MonitorType";
import {
  readSecurityEntities,
  SecurityEntity,
  SecurityEntityType,
} from "../../../../Types/SecurityCase/SecurityEntity";
import SliType from "../../../../Types/ServiceLevelObjective/SliType";
import SloStatus from "../../../../Types/ServiceLevelObjective/SloStatus";
import SloWindowType from "../../../../Types/ServiceLevelObjective/SloWindowType";

/*
 * THE CARD A READ LEAVES, AS WORDS (issue #7175).
 *
 * Each read tool that leaves a card under the answer - a monitor, an SLO, a
 * team, an on-call policy or schedule, a status page, a runbook, a
 * workflow, a security case - says what it shows here, as words of
 * Types/AI/AIActionWords, which the Dashboard says in the reader's
 * language: the record's kind and each fact's name a term, OneUptime's own
 * values ("Off - not checked", "Disabled", a monitor type's name) terms
 * and sentences, figures written the reader's way, moments in the reader's
 * time zone - and the data as written: a name, a status name the project
 * chose, a description, a URL. WidgetBuilder.resourceCard stores the same
 * words in English beside them, for the exports, and for a Dashboard that
 * cannot read them.
 *
 * Plain data in, words out - no reads - so the tools, the tests and the
 * offline browser fixture build each card the same way.
 */

// A figure the server rounds before the card stores it: two decimals, as the card always said.
function roundFigure(value: number): number {
  return Math.round(value * 100) / 100;
}

// A fact whose value is data, when there is any.
function dataFact(
  label: string,
  value: string | undefined | null,
): Array<AIActionCardFact> {
  return value ? [aiActionCardFact(label, value)] : [];
}

/*
 * A monitor type's name, as the type picker and the Monitors list write
 * it ("Docker Container" for Docker): null for a type it does not list.
 */
export function getMonitorTypeTitle(
  monitorType: string | undefined | null,
): string | null {
  if (!monitorType) {
    return null;
  }

  const props: MonitorTypeProps | undefined =
    MonitorTypeHelper.getAllMonitorTypeProps().find(
      (item: MonitorTypeProps): boolean => {
        return item.monitorType === monitorType;
      },
    );

  return props ? props.title : null;
}

/*
 * ---------------------------------------------------------------------------
 * query_monitors, one monitor (MonitorTools)
 * ---------------------------------------------------------------------------
 */
export interface MonitorCardData {
  monitorType?: string | undefined;
  // The status the monitor holds: a name the project chose ("Offline").
  statusName?: string | undefined;
  isMonitoringOff: boolean;
  isArchived: boolean;
  ownerTeamNames?: string | undefined;
  ownerUserNames?: string | undefined;
}

export function getMonitorCardWords(data: MonitorCardData): AIActionCardWords {
  const typeTitle: string | null = getMonitorTypeTitle(data.monitorType);
  const facts: Array<AIActionCardFact> = [];

  if (data.monitorType) {
    facts.push(
      aiActionCardFact(
        AI_READ_CARD_FACTS.type,
        typeTitle ? aiActionTerm(typeTitle) : data.monitorType,
      ),
    );
  }

  /*
   * A monitor whose monitoring is off is not in that status now: its card
   * says Disabled under its name, and this is the status its last check
   * saw, said as the last one.
   */
  facts.push(
    ...dataFact(
      data.isMonitoringOff
        ? AI_READ_CARD_FACTS.lastStatus
        : AI_READ_CARD_FACTS.status,
      data.statusName,
    ),
  );

  if (data.isArchived) {
    facts.push(
      aiActionCardFact(
        AI_READ_CARD_FACTS.archived,
        aiActionTerm(AI_READ_CARD_VALUES.monitorArchived),
      ),
    );
  }

  if (data.isMonitoringOff) {
    facts.push(
      aiActionCardFact(
        AI_READ_CARD_FACTS.monitoring,
        aiActionTerm(AI_READ_CARD_VALUES.monitoringOff),
      ),
    );
  }

  facts.push(...dataFact(AI_READ_CARD_FACTS.ownerTeams, data.ownerTeamNames));
  facts.push(...dataFact(AI_READ_CARD_FACTS.ownerUsers, data.ownerUserNames));

  /*
   * What the Monitors table says of it under its name: Disabled when its
   * monitoring is off, not the status it was frozen at.
   */
  const line: Array<AIActionSentence | string> = data.isMonitoringOff
    ? [aiActionSentence(AI_READ_CARD_LINES.disabled)]
    : data.statusName
      ? [data.statusName]
      : [];

  return {
    kind: aiActionTerm(AI_READ_CARD_KINDS.monitor),
    ...(line.length > 0 ? { line } : {}),
    facts,
  };
}

/*
 * ---------------------------------------------------------------------------
 * query_slos, one SLO (SloTools)
 * ---------------------------------------------------------------------------
 */
export interface SloCardData {
  description?: string | undefined;
  targetPercentage?: number | undefined | null;
  windowType?: SloWindowType | string | undefined | null;
  windowDays?: number | undefined | null;
  sliType?: SliType | string | undefined | null;
  isArchived: boolean;
  isEnabled: boolean;
  sloStatus?: SloStatus | string | undefined | null;
  currentSliPercentage?: number | undefined | null;
  errorBudgetRemainingPercentage?: number | undefined | null;
  currentBurnRate?: number | undefined | null;
  // The SLO's monitors, by name, joined.
  monitorNames: string;
  monitorRules: { isVisible: boolean; count: number; enabledCount: number };
  burnRateRules: { isVisible: boolean; count: number };
  policyTiers: {
    // The tier the SLO is in, by the name its team gave it.
    currentName?: string | undefined;
    isVisible: boolean;
    count: number;
  };
  // Whether the deploy gate lets a release through; false only when frozen.
  deploymentsAllowed?: boolean | undefined | null;
}

const DEFAULT_ROLLING_WINDOW_DAYS: number = 30;

// A share, or "Not evaluated yet" before the worker first evaluates the SLO.
function sloPercent(value: number | undefined | null): AIActionCardValue {
  return value === undefined || value === null || !Number.isFinite(value)
    ? aiActionTerm(AI_READ_CARD_VALUES.notEvaluatedYet)
    : aiActionFigure(roundFigure(value), { isPercent: true });
}

/*
 * The one-word state a person sees in the SLO list, with the same
 * precedence its Status column uses: Archived, then Disabled, then the
 * persisted status. None before the worker first evaluates it.
 */
function sloStatusValue(data: SloCardData): AIActionCardValue | null {
  if (data.isArchived) {
    return aiActionTerm(AI_READ_CARD_VALUES.archived);
  }

  if (!data.isEnabled) {
    return aiActionTerm(AI_READ_CARD_VALUES.disabled);
  }

  if (!data.sloStatus) {
    return null;
  }

  const word: string | undefined =
    AI_READ_CARD_SLO_STATUSES[data.sloStatus as SloStatus];

  return word ? aiActionTerm(word) : data.sloStatus;
}

export function getSloCardWords(data: SloCardData): AIActionCardWords {
  const status: AIActionCardValue | null = sloStatusValue(data);

  const window: AIActionCardValue =
    data.windowType === SloWindowType.CalendarMonth
      ? aiActionTerm(AI_READ_CARD_VALUES.calendarMonth)
      : aiActionPluralSentence(
          AI_READ_CARD_PLURAL_SENTENCES.rollingWindow,
          data.windowDays && data.windowDays > 0
            ? data.windowDays
            : DEFAULT_ROLLING_WINDOW_DAYS,
        );

  // Not "None" when the rules could not be read: that would claim the monitors are picked by hand.
  const monitorRules: AIActionCardValue = !data.monitorRules.isVisible
    ? aiActionTerm(AI_READ_CARD_VALUES.notVisible)
    : data.monitorRules.count === 0
      ? aiActionTerm(AI_READ_CARD_VALUES.monitorsPickedByHand)
      : aiActionPluralSentence(
          AI_READ_CARD_PLURAL_SENTENCES.rulesEnabled,
          data.monitorRules.count,
          { enabled: aiActionFigure(data.monitorRules.enabledCount) },
        );

  /*
   * The tier is SLO data, so it shows even when the tiers cannot be read;
   * "No error budget policy" only when nothing says otherwise.
   */
  const policyTier: AIActionCardValue =
    data.policyTiers.currentName ||
    (!data.policyTiers.isVisible
      ? aiActionTerm(AI_READ_CARD_VALUES.notVisible)
      : data.policyTiers.count === 0
        ? aiActionTerm(AI_READ_CARD_VALUES.noErrorBudgetPolicy)
        : aiActionTerm(AI_READ_CARD_VALUES.aboveEveryTier));

  const facts: Array<AIActionCardFact> = [
    aiActionCardFact(
      AI_READ_CARD_FACTS.target,
      sloPercent(data.targetPercentage),
    ),
    aiActionCardFact(AI_READ_CARD_FACTS.window, window),
    // Monitor uptime is the column's default, and what the worker evaluates.
    aiActionCardFact(
      AI_READ_CARD_FACTS.sliType,
      aiActionTerm(
        data.sliType === SliType.Metric
          ? AI_READ_CARD_VALUES.metric
          : AI_READ_CARD_VALUES.monitorUptime,
      ),
    ),
    ...(status ? [aiActionCardFact(AI_READ_CARD_FACTS.status, status)] : []),
    aiActionCardFact(
      AI_READ_CARD_FACTS.currentSli,
      sloPercent(data.currentSliPercentage),
    ),
    aiActionCardFact(
      AI_READ_CARD_FACTS.errorBudgetLeft,
      sloPercent(data.errorBudgetRemainingPercentage),
    ),
    aiActionCardFact(
      AI_READ_CARD_FACTS.burnRate,
      data.currentBurnRate === undefined ||
        data.currentBurnRate === null ||
        !Number.isFinite(data.currentBurnRate)
        ? aiActionTerm(AI_READ_CARD_VALUES.notEvaluatedYet)
        : aiActionFigure(roundFigure(data.currentBurnRate)),
    ),
    aiActionCardFact(
      AI_READ_CARD_FACTS.monitors,
      data.monitorNames || aiActionTerm(AI_READ_CARD_VALUES.none),
    ),
    aiActionCardFact(AI_READ_CARD_FACTS.monitorRules, monitorRules),
    // Not "0" when the rules could not be read.
    aiActionCardFact(
      AI_READ_CARD_FACTS.burnRateRules,
      data.burnRateRules.isVisible
        ? aiActionFigure(data.burnRateRules.count)
        : aiActionTerm(AI_READ_CARD_VALUES.notVisible),
    ),
    aiActionCardFact(AI_READ_CARD_FACTS.errorBudgetPolicyTier, policyTier),
    // SLO data too: shown whether or not the tiers can be read.
    aiActionCardFact(
      AI_READ_CARD_FACTS.deployments,
      aiActionTerm(
        data.deploymentsAllowed === false
          ? AI_READ_CARD_VALUES.deploymentsFrozen
          : AI_READ_CARD_VALUES.deploymentsAllowed,
      ),
    ),
  ];

  return {
    kind: aiActionTerm(AI_READ_CARD_KINDS.slo),
    ...(data.description ? { line: [data.description] } : {}),
    facts,
  };
}

/*
 * ---------------------------------------------------------------------------
 * query_teams, one team with no members (TeamTools): a team with members
 * leaves the table of them. Its line says No members, so no "Members: 0"
 * fact says it again under it.
 * ---------------------------------------------------------------------------
 */
export function getEmptyTeamCardWords(data: {
  description?: string | undefined;
}): AIActionCardWords {
  return {
    kind: aiActionTerm(AI_READ_CARD_KINDS.team),
    line: [aiActionSentence(AI_READ_CARD_LINES.noMembers)],
    facts: [
      aiActionCardFact(
        AI_ACTION_CARD_FACTS.description,
        data.description || "—",
      ),
    ],
  };
}

/*
 * ---------------------------------------------------------------------------
 * query_on_call_policies, one policy (OnCallTools)
 * ---------------------------------------------------------------------------
 */
export interface EscalationRuleCardData {
  order?: number | undefined | null;
  name?: string | undefined | null;
  // Who it pages, by name.
  users: Array<string>;
  teams: Array<string>;
  schedules: Array<string>;
  escalateAfterInMinutes?: number | undefined | null;
}

// A rule's name: "Rule 1", or "Rule 2 — Database team".
function escalationRuleLabel(rule: EscalationRuleCardData): AIActionSentence {
  const order: AIActionSentenceValue =
    typeof rule.order === "number" && Number.isFinite(rule.order)
      ? aiActionFigure(rule.order)
      : "?";

  return rule.name
    ? aiActionSentence(AI_READ_CARD_SENTENCES.ruleNamed, {
        order,
        name: rule.name,
      })
    : aiActionSentence(AI_READ_CARD_SENTENCES.rule, { order });
}

/*
 * What a rule pages, each by its kind and name - 'user "Ana", team
 * "SRE"' - and when it escalates.
 */
function escalationRuleValue(rule: EscalationRuleCardData): AIActionSentence {
  const targets: Array<AIActionSentence> = [
    ...rule.users.map((name: string): AIActionSentence => {
      return aiActionResourceByName({ noun: AI_READ_CARD_NOUNS.user, name });
    }),
    ...rule.teams.map((name: string): AIActionSentence => {
      return aiActionResourceByName({ noun: AI_READ_CARD_NOUNS.team, name });
    }),
    ...rule.schedules.map((name: string): AIActionSentence => {
      return aiActionResourceByName({
        noun: AI_READ_CARD_NOUNS.onCallSchedule,
        name,
      });
    }),
  ];
  const minutes: number | null =
    typeof rule.escalateAfterInMinutes === "number" &&
    rule.escalateAfterInMinutes > 0
      ? rule.escalateAfterInMinutes
      : null;

  if (targets.length === 0) {
    return minutes === null
      ? aiActionSentence(AI_READ_CARD_SENTENCES.pagesNoOne)
      : aiActionPluralSentence(
          AI_READ_CARD_PLURAL_SENTENCES.pagesNoOneThenEscalates,
          minutes,
        );
  }

  return minutes === null
    ? aiActionSentence(AI_READ_CARD_SENTENCES.pages, {
        targets: aiActionList(targets),
      })
    : aiActionPluralSentence(
        AI_READ_CARD_PLURAL_SENTENCES.pagesThenEscalates,
        minutes,
        { targets: aiActionList(targets) },
      );
}

export function getOnCallPolicyCardWords(data: {
  description?: string | undefined;
  isArchived: boolean;
  rules: Array<EscalationRuleCardData>;
}): AIActionCardWords {
  return {
    kind: aiActionTerm(AI_ACTION_CARD_KINDS.onCallPolicy),
    ...(data.description ? { line: [data.description] } : {}),
    facts: [
      ...(data.isArchived
        ? [
            aiActionCardFact(
              AI_READ_CARD_FACTS.archived,
              aiActionTerm(AI_READ_CARD_VALUES.onCallPolicyArchived),
            ),
          ]
        : []),
      ...(data.rules.length > 0
        ? data.rules.map((rule: EscalationRuleCardData): AIActionCardFact => {
            return {
              label: escalationRuleLabel(rule),
              value: escalationRuleValue(rule),
            };
          })
        : [
            aiActionCardFact(
              AI_READ_CARD_FACTS.escalationRules,
              aiActionTerm(AI_READ_CARD_VALUES.noEscalationRules),
            ),
          ]),
    ],
  };
}

/*
 * ---------------------------------------------------------------------------
 * who_is_on_call, one schedule (OnCallTools)
 * ---------------------------------------------------------------------------
 */
export function getOnCallScheduleCardWords(data: {
  // Who is on call now, by name; none when no one is.
  onCallNow?: string | undefined;
  rosterStartAt?: Date | undefined;
  rosterHandoffAt?: Date | undefined;
  nextUp?: string | undefined;
  rosterNextStartAt?: Date | undefined;
}): AIActionCardWords {
  const facts: Array<AIActionCardFact> = [];

  if (data.rosterStartAt) {
    facts.push(
      aiActionCardFact(
        AI_READ_CARD_FACTS.onCallSince,
        aiActionMoment(data.rosterStartAt),
      ),
    );
  }

  if (data.rosterHandoffAt) {
    facts.push(
      aiActionCardFact(
        AI_READ_CARD_FACTS.handsOffAt,
        aiActionMoment(data.rosterHandoffAt),
      ),
    );
  }

  facts.push(...dataFact(AI_READ_CARD_FACTS.nextUp, data.nextUp));

  if (data.rosterNextStartAt) {
    facts.push(
      aiActionCardFact(
        AI_READ_CARD_FACTS.nextShiftStarts,
        aiActionMoment(data.rosterNextStartAt),
      ),
    );
  }

  return {
    kind: aiActionTerm(AI_READ_CARD_KINDS.onCallSchedule),
    line: [
      data.onCallNow
        ? aiActionSentence(AI_READ_CARD_LINES.onCallNow, {
            name: data.onCallNow,
          })
        : aiActionSentence(AI_READ_CARD_LINES.noOneOnCall),
    ],
    facts,
  };
}

/*
 * ---------------------------------------------------------------------------
 * query_status_pages, one page (StatusPageTools)
 * ---------------------------------------------------------------------------
 */
export interface StatusPageResourceCardData {
  // The name the page shows it by.
  name: string;
  // The monitor or monitor group it shows, when the page names it otherwise.
  source?: { name: string; isMonitorGroup: boolean } | undefined;
  // The page draws it as Not monitored: its monitoring is off.
  isNotMonitored: boolean;
}

function statusPageResource(
  resource: StatusPageResourceCardData,
): AIActionSentence {
  const named: AIActionSentence = resource.source
    ? resource.source.isMonitorGroup
      ? aiActionSentence(AI_READ_CARD_SENTENCES.resourceFromMonitorGroup, {
          name: resource.name,
          group: resource.source.name,
        })
      : aiActionSentence(AI_READ_CARD_SENTENCES.resourceFromMonitor, {
          name: resource.name,
          monitor: resource.source.name,
        })
    : aiActionSentence(AI_READ_CARD_NAME, { name: resource.name });

  return resource.isNotMonitored
    ? aiActionSentence(AI_READ_CARD_SENTENCES.resourceNotMonitored, {
        resource: aiActionList([named]),
      })
    : named;
}

export function getStatusPageCardWords(data: {
  description?: string | undefined;
  isPublic: boolean;
  isArchived: boolean;
  publicUrl?: string | undefined;
  // How many resources the page shows, and those it names.
  resourceCount: number;
  resources: Array<StatusPageResourceCardData>;
  activeSubscribers: number;
}): AIActionCardWords {
  const facts: Array<AIActionCardFact> = [
    aiActionCardFact(
      AI_READ_CARD_FACTS.visibility,
      aiActionTerm(
        data.isPublic
          ? AI_READ_CARD_VALUES.public
          : AI_READ_CARD_VALUES.private,
      ),
    ),
  ];

  if (data.isArchived) {
    facts.push(
      aiActionCardFact(
        AI_READ_CARD_FACTS.archived,
        aiActionTerm(AI_READ_CARD_VALUES.statusPageArchived),
      ),
    );
  }

  facts.push(...dataFact(AI_READ_CARD_FACTS.publicUrl, data.publicUrl));

  facts.push(
    aiActionCardFact(
      AI_READ_CARD_FACTS.resourcesShown,
      data.resources.length > 0
        ? aiActionSentence(AI_READ_CARD_COUNTED, {
            count: aiActionFigure(data.resourceCount),
            items: aiActionList(data.resources.map(statusPageResource)),
          })
        : aiActionFigure(0),
    ),
  );

  facts.push(
    aiActionCardFact(
      AI_READ_CARD_FACTS.activeSubscribers,
      aiActionFigure(data.activeSubscribers),
    ),
  );

  return {
    kind: aiActionTerm(AI_READ_CARD_KINDS.statusPage),
    ...(data.description ? { line: [data.description] } : {}),
    facts,
  };
}

/*
 * ---------------------------------------------------------------------------
 * query_runbooks, one runbook with no steps (RunbookTools): one with steps
 * leaves the table of them.
 * ---------------------------------------------------------------------------
 */
export function getEmptyRunbookCardWords(data: {
  description?: string | undefined;
  isEnabled: boolean;
}): AIActionCardWords {
  return {
    kind: aiActionTerm(AI_ACTION_CARD_KINDS.runbook),
    line: [
      aiActionSentence(
        data.isEnabled
          ? AI_READ_CARD_LINES.enabled
          : AI_READ_CARD_LINES.disabled,
      ),
    ],
    facts: [
      aiActionCardFact(
        AI_ACTION_CARD_FACTS.description,
        data.description || "—",
      ),
      aiActionCardFact(AI_READ_CARD_FACTS.steps, aiActionFigure(0)),
    ],
  };
}

/*
 * ---------------------------------------------------------------------------
 * query_workflows, one workflow with no runs (WorkflowProbeTools): one
 * with runs leaves the table of them.
 * ---------------------------------------------------------------------------
 */
export function getUnrunWorkflowCardWords(data: {
  description?: string | undefined;
  isEnabled: boolean;
  isArchived: boolean;
}): AIActionCardWords {
  return {
    kind: aiActionTerm(AI_ACTION_CARD_KINDS.workflow),
    ...(data.description ? { line: [data.description] } : {}),
    facts: [
      aiActionCardFact(
        AI_READ_CARD_FACTS.enabled,
        aiActionTerm(
          data.isEnabled ? AI_READ_CARD_VALUES.yes : AI_READ_CARD_VALUES.no,
        ),
      ),
      ...(data.isArchived
        ? [
            aiActionCardFact(
              AI_READ_CARD_FACTS.archived,
              aiActionTerm(AI_READ_CARD_VALUES.workflowArchived),
            ),
          ]
        : []),
      aiActionCardFact(AI_READ_CARD_FACTS.recentRuns, aiActionFigure(0)),
    ],
  };
}

/*
 * ---------------------------------------------------------------------------
 * query_security_cases, one case (SecurityCaseTools)
 * ---------------------------------------------------------------------------
 */

// A case's entity, by its kind and value: "IP Address: 10.0.0.7".
function securityEntity(entity: SecurityEntity): AIActionSentence {
  return aiActionSentence(AI_READ_CARD_ENTITY, {
    type: aiActionTerm(entity.type || SecurityEntityType.Other),
    value: entity.value,
  });
}

export function getSecurityCaseCardWords(data: {
  // The project's own names for the case's status and priority: data.
  statusName: string;
  priorityName: string;
  detectionCount: number;
  // The case's stored entities, as SecurityEntity reads them.
  entities: unknown;
}): AIActionCardWords {
  const entities: Array<SecurityEntity> = readSecurityEntities(data.entities);
  const line: Array<string> = [data.statusName, data.priorityName].filter(
    (part: string): boolean => {
      return Boolean(part);
    },
  );

  return {
    kind: aiActionTerm(AI_ACTION_CARD_KINDS.securityCase),
    ...(line.length > 0 ? { line } : {}),
    facts: [
      aiActionCardFact(
        AI_READ_CARD_FACTS.detections,
        aiActionFigure(data.detectionCount),
      ),
      aiActionCardFact(
        AI_READ_CARD_FACTS.entities,
        entities.length > 0 ? aiActionList(entities.map(securityEntity)) : "-",
      ),
    ],
  };
}

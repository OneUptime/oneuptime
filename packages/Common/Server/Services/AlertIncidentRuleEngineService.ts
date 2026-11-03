import Alert from "../../Models/DatabaseModels/Alert";
import AlertIncidentRule from "../../Models/DatabaseModels/AlertIncidentRule";
import AlertSeverity from "../../Models/DatabaseModels/AlertSeverity";
import BaseModel from "../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Incident from "../../Models/DatabaseModels/Incident";
import IncidentSeverity from "../../Models/DatabaseModels/IncidentSeverity";
import Label from "../../Models/DatabaseModels/Label";
import Monitor from "../../Models/DatabaseModels/Monitor";
import { AlertFeedEventType } from "../../Models/DatabaseModels/AlertFeed";
import AlertFeedService from "./AlertFeedService";
import AlertIncidentRuleService from "./AlertIncidentRuleService";
import AlertService from "./AlertService";
import AlertSeverityService from "./AlertSeverityService";
import AlertStateService from "./AlertStateService";
import IncidentAlertService from "./IncidentAlertService";
import IncidentService from "./IncidentService";
import IncidentSeverityService from "./IncidentSeverityService";
import MonitorService from "./MonitorService";
import {
  ALERT_INCIDENT_RULE_KIND,
  INCIDENT_ALERT_IDS_TO_LINK_KEY,
  INCIDENT_DECLARED_BY_ALERT_INCIDENT_RULE_KEY,
} from "../../Types/Incident/IncidentAlertLink";
import {
  doesAlertIncidentRuleDeclareRightAway,
  formatAlertIncidentRuleWait,
  getAlertIncidentRuleDeclareAt,
  getAlertIncidentRuleWaitInMinutes,
} from "../../Types/Alert/AlertIncidentRuleWait";
import SortOrder from "../../Types/BaseDatabase/SortOrder";
import { Red500 } from "../../Types/BrandColors";
import { LIMIT_PER_PROJECT } from "../../Types/Database/LimitMax";
import OneUptimeDate from "../../Types/Date";
import { JSONObject } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import { isArchivedValue } from "../../Utils/ArchivableValues";
import IncidentFromAlerts, {
  SeverityForMapping,
} from "../../Utils/Incident/IncidentFromAlerts";
import { MarkdownText, mdText } from "../../Utils/Markdown/FeedMarkdown";
import { MAX_RULES_EVALUATED_PER_PROJECT } from "../../Utils/Rules/RuleEngineLimits";
import { RuleCriteriaMatcher } from "../../Utils/Rules/RuleCriteriaMatcher";
import RulePatternMatchUtil from "../../Utils/Rules/RulePatternMatchUtil";
import QueryHelper from "../Types/Database/QueryHelper";
import Select from "../Types/Database/Select";
import { getAffectedResourceColumns } from "../Utils/Database/AffectedResourceRelations";
import logger, { LogAttributes } from "../Utils/Logger";
import { RuleEvaluation } from "../Utils/PatternWorkScope";
import RuleFeedMarkdown from "../Utils/Rules/RuleFeedMarkdown";
import logIfRuleReadWasTruncated from "../Utils/Rules/RuleEngineRuleRead";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import { UpdateResult } from "typeorm";
import { QueryDeepPartialEntity } from "typeorm/query-builder/QueryPartialEntity";

/*
 * ALERT INCIDENT RULES: AN ALERT THAT MATCHES BECOMES AN INCIDENT.
 *
 * When an alert is created, the project's enabled alert incident rules are
 * read from the top of the list down (the order people drag them into) and
 * the FIRST whose conditions match the alert decides:
 *
 *   - a rule that declares right away declares an incident from the alert
 *     there and then;
 *   - a rule with a wait ("Declare After") schedules a check for when the
 *     wait is up (Alert.nextIncidentRuleCheckAt), and the worker
 *     (Workers/Jobs/AlertIncidentRules/DeclareIncidentsWhenWaitIsUp) runs
 *     it: an alert resolved by then never becomes an incident; one still
 *     unresolved is matched again, as it is then - its severity or labels
 *     may have changed - and the first rule that matches decides again,
 *     declaring now when its own wait is up, or waiting longer when it is
 *     not.
 *
 * The first match decides, rather than every match together, because an
 * alert is declared from once and a rule's severity and wait are what it is
 * for: a narrow rule ("Critical database alerts become SEV1 right away")
 * above a broad one ("every alert still open after 30 minutes") is how a
 * project says both.
 *
 * Declaring is what "Declare Incident" on the alert's page does
 * (IncidentFromAlerts), as OneUptime: the incident takes the alert's title
 * and description, its monitor, the resources it affects and its live
 * labels, and is private when the alert is; it is created through
 * IncidentService with the alert to link (INCIDENT_ALERT_IDS_TO_LINK_KEY),
 * so it is linked, announced once in the incident's feed - naming the rule
 * (INCIDENT_DECLARED_BY_ALERT_INCIDENT_RULE_KEY) - and, when private, given
 * the alert's owners, exactly as a declaration by hand. Its severity is the
 * rule's, or the incident severity that corresponds to the alert's. The
 * incident's own rules - on-call, owners, labels, privacy, grouping - then
 * run on it as on every new incident. Its on-call policies are never copied
 * from the alert: declaring must not page anyone the incident's own rules
 * do not.
 *
 * An alert already linked to an incident is left alone - declared by hand,
 * linked from the alerts list, or declared by a rule before - so an alert
 * becomes at most one incident this way.
 *
 * Nothing here ever throws into the alert's create chain or the worker: a
 * failure is logged, and the alert is left as it was.
 */

// What a rule is read with: its conditions, its place and what it declares.
const RULE_SELECT: Select<AlertIncidentRule> = {
  _id: true,
  name: true,
  // Sorted on, so selected: the read with relations orders by selected columns only.
  order: true,
  createdAt: true,
  criteria: true,
  monitors: { _id: true },
  alertSeverities: { _id: true },
  alertLabels: { _id: true },
  monitorLabels: { _id: true },
  alertTitlePattern: true,
  alertDescriptionPattern: true,
  monitorNamePattern: true,
  monitorDescriptionPattern: true,
  incidentSeverityId: true,
  declareAfterInMinutes: true,
  showIncidentOnStatusPage: true,
};

// The match columns every alert rule offers, as the rule's legacy fields.
const LEGACY_MATCH_FIELDS: ReadonlyArray<
  Extract<keyof AlertIncidentRule, string>
> = [
  "monitors",
  "alertSeverities",
  "alertLabels",
  "monitorLabels",
  "alertTitlePattern",
  "alertDescriptionPattern",
  "monitorNamePattern",
  "monitorDescriptionPattern",
];

/*
 * The lists of affected resources an incident takes from its alert: every
 * one the two models both carry (AffectedResourceRelations) and their
 * service level objectives. Built per call: the relations module reads
 * services that are still loading when this module is.
 */
export function getAlertIncidentRuleResourceColumns(): Array<string> {
  const alert: Alert = new Alert();
  const incident: Incident = new Incident();

  return [
    ...getAffectedResourceColumns(incident),
    "serviceLevelObjectives",
  ].filter((column: string): boolean => {
    return alert.hasColumn(column) && incident.hasColumn(column);
  });
}

/*
 * What matching an alert and declaring from it read of the alert: what the
 * rules' conditions look at, what the incident takes from it, and what says
 * whether it may be declared from at all.
 */
export function getAlertIncidentRuleAlertSelect(): Select<Alert> {
  const select: Record<string, unknown> = {
    _id: true,
    projectId: true,
    createdAt: true,
    title: true,
    description: true,
    monitorId: true,
    alertSeverityId: true,
    currentAlertStateId: true,
    alertNumber: true,
    alertNumberWithPrefix: true,
    isPrivate: true,
    labels: { _id: true, isArchived: true },
  };

  for (const column of getAlertIncidentRuleResourceColumns()) {
    select[column] = { _id: true };
  }

  return select as Select<Alert>;
}

/*
 * What the alert's feed says a rule declared: "Declared **[Incident
 * #12](link)** from this alert.", and for a rule that waited, "... from this
 * alert: it had stayed unresolved for 15 minutes." The incident is named by
 * its number and link only - never its title, as the alert's other entries
 * name a linked incident that may be private.
 */
export function getAlertIncidentRuleDeclaredSentence(data: {
  // "Incident #12", "Incident INC-12".
  incidentLabel: string;
  incidentLink: string;
  declareAfterInMinutes: unknown;
}): MarkdownText {
  const declared: MarkdownText = mdText`Declared **[${data.incidentLabel}](${data.incidentLink})** from this alert`;

  if (doesAlertIncidentRuleDeclareRightAway(data.declareAfterInMinutes)) {
    return mdText`${declared}.`;
  }

  return mdText`${declared}: it had stayed unresolved for ${formatAlertIncidentRuleWait(
    getAlertIncidentRuleWaitInMinutes(data.declareAfterInMinutes),
  )}.`;
}

// What the engine did with an alert, for the logs and the tests.
export enum AlertIncidentRuleOutcome {
  // No enabled rule, or none matched: the alert stays an alert.
  NoRuleMatched = "NoRuleMatched",
  // The alert is linked to an incident already.
  AlreadyLinked = "AlreadyLinked",
  // The alert was resolved before the rule's wait was up.
  Resolved = "Resolved",
  // The rule that matched waits: a check is scheduled for when it is up.
  Waiting = "Waiting",
  // An incident was declared from the alert.
  Declared = "Declared",
  // The check was not due, or another run of the worker claimed it.
  NotDue = "NotDue",
  // The alert could not be read, or declaring failed (logged).
  Failed = "Failed",
}

/*
 * How many alerts whose check is due one run of the worker checks, oldest
 * first; the rest are checked on the next run, a minute later. A check
 * can declare an incident - a full create - so a storm of alerts waiting
 * on one rule is worked through a run at a time rather than in one
 * unbounded run that overlaps the next.
 */
export const ALERT_INCIDENT_RULE_CHECKS_PER_RUN: number = 100;

export interface AlertIncidentRuleResult {
  outcome: AlertIncidentRuleOutcome;
  // The rule that matched, when one did.
  ruleId?: ObjectID | undefined;
  // The incident declared, when one was.
  incidentId?: ObjectID | undefined;
  // When the alert is checked again, while a rule waits.
  checkAt?: Date | undefined;
}

class AlertIncidentRuleEngineServiceClass {
  /*
   * A new alert - one that does not start resolved (AlertService runs this
   * only for one that is ongoing): declares from it when the first rule
   * that matches declares right away, or schedules the check of a rule that
   * waits. The alert is read again as stored, after the alert's own privacy,
   * owner and label rules have run, so the conditions see its labels and
   * the incident takes them. A project without an enabled rule reads
   * nothing more.
   */
  @CaptureSpan()
  @RuleEvaluation()
  public async applyRulesToAlert(
    alert: Alert,
  ): Promise<AlertIncidentRuleResult> {
    if (!alert.id || !alert.projectId) {
      return { outcome: AlertIncidentRuleOutcome.NoRuleMatched };
    }

    try {
      const rules: Array<AlertIncidentRule> = await this.findEnabledRules(
        alert.projectId,
      );

      if (rules.length === 0) {
        return { outcome: AlertIncidentRuleOutcome.NoRuleMatched };
      }

      const storedAlert: Alert | null = await this.readAlert(alert.id);

      if (!storedAlert) {
        return { outcome: AlertIncidentRuleOutcome.Failed };
      }

      return await this.decide({
        alert: storedAlert,
        rules: rules,
        now: OneUptimeDate.getCurrentDate(),
      });
    } catch (error) {
      logger.error(
        `AlertIncidentRuleEngine: applying alert incident rules failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
        {
          projectId: alert.projectId?.toString(),
          alertId: alert.id?.toString(),
        } as LogAttributes,
      );

      return { outcome: AlertIncidentRuleOutcome.Failed };
    }
  }

  /*
   * The worker's minute (Workers/Jobs/AlertIncidentRules/
   * DeclareIncidentsWhenWaitIsUp): every alert whose check is due, oldest
   * first, up to ALERT_INCIDENT_RULE_CHECKS_PER_RUN of them. The checks are
   * on the alerts, so one that came due while the workers were down is run
   * on the first run after they are back. Never throws: a check that fails
   * is logged, and the others still run.
   */
  @CaptureSpan()
  public async runDueChecks(): Promise<Array<AlertIncidentRuleResult>> {
    const now: Date = OneUptimeDate.getCurrentDate();
    const results: Array<AlertIncidentRuleResult> = [];

    let alerts: Array<Alert> = [];

    try {
      alerts = await this.findAlertsDueForCheck({
        now: now,
        limit: ALERT_INCIDENT_RULE_CHECKS_PER_RUN,
      });
    } catch (error) {
      logger.error(
        `AlertIncidentRuleEngine: reading the alerts whose wait is up failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );

      return results;
    }

    for (const alert of alerts) {
      if (!alert.id) {
        continue;
      }

      results.push(
        await this.checkAlertWhenWaitIsUp({ alertId: alert.id, now: now }),
      );
    }

    return results;
  }

  /*
   * The alerts whose check is due (Alert.nextIncidentRuleCheckAt at or
   * before `now`), oldest first, at most `limit` of them.
   */
  @CaptureSpan()
  public async findAlertsDueForCheck(data: {
    now: Date;
    limit: number;
  }): Promise<Array<Alert>> {
    return await AlertService.findBy({
      query: {
        nextIncidentRuleCheckAt: QueryHelper.lessThanEqualTo(data.now),
      },
      select: {
        _id: true,
        projectId: true,
        nextIncidentRuleCheckAt: true,
      },
      sort: {
        nextIncidentRuleCheckAt: SortOrder.Ascending,
      },
      limit: data.limit,
      skip: 0,
      props: {
        isRoot: true,
      },
    });
  }

  /*
   * An alert whose check is due: claims the check - clears it, but only
   * while it is still due, in one statement, so two runs of the worker
   * never both declare - then, unless the alert has been resolved since,
   * matches it again and declares, or waits longer, as the first rule that
   * matches it now says.
   */
  @CaptureSpan()
  @RuleEvaluation()
  public async checkAlertWhenWaitIsUp(data: {
    alertId: ObjectID;
    now: Date;
  }): Promise<AlertIncidentRuleResult> {
    try {
      if (!(await this.claimDueCheck(data))) {
        // Another run claimed it, or it is no longer due.
        return { outcome: AlertIncidentRuleOutcome.NotDue };
      }

      const alert: Alert | null = await this.readAlert(data.alertId);

      if (!alert || !alert.projectId) {
        return { outcome: AlertIncidentRuleOutcome.Failed };
      }

      if (
        alert.currentAlertStateId &&
        (await AlertStateService.isResolvedAlertState({
          projectId: alert.projectId,
          alertStateId: alert.currentAlertStateId,
        }))
      ) {
        return { outcome: AlertIncidentRuleOutcome.Resolved };
      }

      const rules: Array<AlertIncidentRule> = await this.findEnabledRules(
        alert.projectId,
      );

      if (rules.length === 0) {
        return { outcome: AlertIncidentRuleOutcome.NoRuleMatched };
      }

      return await this.decide({
        alert: alert,
        rules: rules,
        now: data.now,
      });
    } catch (error) {
      logger.error(
        `AlertIncidentRuleEngine: checking an alert whose wait is up failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
        { alertId: data.alertId.toString() } as LogAttributes,
      );

      return { outcome: AlertIncidentRuleOutcome.Failed };
    }
  }

  /*
   * What the first rule that matches the alert says: declare now, or check
   * again when its wait is up. An alert linked to an incident already, or
   * one no rule matches, is left alone.
   */
  private async decide(data: {
    alert: Alert;
    rules: Array<AlertIncidentRule>;
    now: Date;
  }): Promise<AlertIncidentRuleResult> {
    const { alert, rules, now } = data;

    if (await this.isLinkedToAnIncident(alert)) {
      return { outcome: AlertIncidentRuleOutcome.AlreadyLinked };
    }

    const rule: AlertIncidentRule | null = await this.findFirstMatchingRule(
      alert,
      rules,
    );

    if (!rule) {
      return { outcome: AlertIncidentRuleOutcome.NoRuleMatched };
    }

    if (!doesAlertIncidentRuleDeclareRightAway(rule.declareAfterInMinutes)) {
      const declareAt: Date = getAlertIncidentRuleDeclareAt({
        alertCreatedAt: alert.createdAt
          ? OneUptimeDate.fromString(alert.createdAt)
          : now,
        waitInMinutes: rule.declareAfterInMinutes,
      });

      if (declareAt.getTime() > now.getTime()) {
        await this.scheduleCheck({ alertId: alert.id!, checkAt: declareAt });

        return {
          outcome: AlertIncidentRuleOutcome.Waiting,
          ruleId: rule.id || undefined,
          checkAt: declareAt,
        };
      }
    }

    const incidentId: ObjectID | null = await this.declareIncident({
      alert: alert,
      rule: rule,
    });

    if (!incidentId) {
      return {
        outcome: AlertIncidentRuleOutcome.Failed,
        ruleId: rule.id || undefined,
      };
    }

    return {
      outcome: AlertIncidentRuleOutcome.Declared,
      ruleId: rule.id || undefined,
      incidentId: incidentId,
    };
  }

  // The project's enabled rules, top of the list first.
  private async findEnabledRules(
    projectId: ObjectID,
  ): Promise<Array<AlertIncidentRule>> {
    const rules: Array<AlertIncidentRule> =
      await AlertIncidentRuleService.findBy({
        query: {
          projectId: projectId,
          isEnabled: true,
        },
        select: RULE_SELECT,
        // The list as people put it in order; the older first on a tie.
        sort: {
          order: SortOrder.Ascending,
          createdAt: SortOrder.Ascending,
        },
        limit: MAX_RULES_EVALUATED_PER_PROJECT,
        skip: 0,
        props: { isRoot: true },
      });

    logIfRuleReadWasTruncated({
      ruleKind: "AlertIncidentRule",
      projectId: projectId,
      rulesRead: rules.length,
    });

    return rules;
  }

  private async findFirstMatchingRule(
    alert: Alert,
    rules: Array<AlertIncidentRule>,
  ): Promise<AlertIncidentRule | null> {
    for (const rule of rules) {
      if (await this.doesAlertMatchRule(alert, rule)) {
        return rule;
      }
    }

    return null;
  }

  private async readAlert(alertId: ObjectID): Promise<Alert | null> {
    return await AlertService.findOneById({
      id: alertId,
      select: getAlertIncidentRuleAlertSelect(),
      props: {
        isRoot: true,
      },
    });
  }

  private async isLinkedToAnIncident(alert: Alert): Promise<boolean> {
    const links: number = (
      await IncidentAlertService.countBy({
        query: {
          alertId: alert.id!,
          projectId: alert.projectId!,
        },
        props: {
          isRoot: true,
        },
      })
    ).toNumber();

    return links > 0;
  }

  /*
   * Clears the alert's check, but only while it is still due: true when
   * this run cleared it, and so is the one to act on it. A write of the one
   * column OneUptime keeps for itself, without the alert's update hooks.
   */
  private async claimDueCheck(data: {
    alertId: ObjectID;
    now: Date;
  }): Promise<boolean> {
    const result: UpdateResult = await AlertService.getRepository()
      .createQueryBuilder()
      .update(Alert)
      .set({
        nextIncidentRuleCheckAt: null,
      } as unknown as QueryDeepPartialEntity<Alert>)
      .where('"_id" = :id', { id: data.alertId.toString() })
      .andWhere('"nextIncidentRuleCheckAt" <= :now', { now: data.now })
      .execute();

    return (result.affected || 0) > 0;
  }

  // When the alert is checked again. Hook-free, as the claim above.
  private async scheduleCheck(data: {
    alertId: ObjectID;
    checkAt: Date;
  }): Promise<void> {
    await AlertService.getRepository()
      .createQueryBuilder()
      .update(Alert)
      .set({
        nextIncidentRuleCheckAt: data.checkAt,
      } as QueryDeepPartialEntity<Alert>)
      .where('"_id" = :id', { id: data.alertId.toString() })
      .execute();
  }

  /*
   * Declares the incident from the alert, as OneUptime, and says so in the
   * alert's feed. The incident id, or null when it could not be declared
   * (logged; the alert is left as it was).
   */
  private async declareIncident(data: {
    alert: Alert;
    rule: AlertIncidentRule;
  }): Promise<ObjectID | null> {
    const { alert, rule } = data;

    const logAttributes: LogAttributes = {
      projectId: alert.projectId?.toString(),
      alertId: alert.id?.toString(),
    } as LogAttributes;

    try {
      const incidentSeverityId: ObjectID | null =
        await this.getIncidentSeverityId({ alert, rule });

      if (!incidentSeverityId) {
        logger.warn(
          `AlertIncidentRuleEngine: no incident was declared from alert ${alert.id?.toString()} by rule ${rule.id?.toString()}: the project has no incident severity to give it.`,
          logAttributes,
        );
        return null;
      }

      const miscDataProps: JSONObject = {
        [INCIDENT_ALERT_IDS_TO_LINK_KEY]: [alert.id!.toString()],
        [INCIDENT_DECLARED_BY_ALERT_INCIDENT_RULE_KEY]:
          rule.name?.toString() || "",
      };

      const createdIncident: Incident = await IncidentService.create({
        data: this.buildIncident({
          alert: alert,
          rule: rule,
          incidentSeverityId: incidentSeverityId,
        }),
        miscDataProps: miscDataProps,
        props: {
          isRoot: true,
        },
      });

      if (!createdIncident.id) {
        return null;
      }

      await this.createRuleExecutedFeedItem({
        alert: alert,
        rule: rule,
        incident: createdIncident,
      });

      logger.debug(
        `AlertIncidentRuleEngine declared incident ${createdIncident.id.toString()} from alert ${alert.id?.toString()} by rule ${rule.id?.toString()}`,
        logAttributes,
      );

      return createdIncident.id;
    } catch (error) {
      logger.error(
        `AlertIncidentRuleEngine: declaring an incident from alert ${alert.id?.toString()} by rule ${rule.id?.toString()} failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
        logAttributes,
      );

      return null;
    }
  }

  /*
   * The incident declared from the alert: what "Declare Incident" on the
   * alert's page fills in (IncidentFromAlerts) - its title, description,
   * monitor and live labels, private when the alert is - with every
   * affected resource the alert lists, shown on status pages as the rule
   * says, and created automatically. No on-call policy: the incident's own
   * rules decide who it pages.
   */
  public buildIncident(data: {
    alert: Alert;
    rule: AlertIncidentRule;
    incidentSeverityId: ObjectID;
  }): Incident {
    const { alert, rule } = data;

    const incident: Incident = new Incident();

    incident.projectId = alert.projectId!;
    incident.title =
      alert.title?.trim() ||
      IncidentFromAlerts.getAlertReference({
        id: alert.id?.toString() || "",
        alertNumber: alert.alertNumber,
        alertNumberWithPrefix: alert.alertNumberWithPrefix,
      });

    if (alert.description?.trim()) {
      incident.description = alert.description;
    }

    incident.incidentSeverityId = data.incidentSeverityId;

    if (alert.monitorId) {
      incident.monitors = [this.toIdOnly(new Monitor(), alert.monitorId)];
    }

    for (const column of getAlertIncidentRuleResourceColumns()) {
      const modelType: { new (): BaseModel } | undefined =
        incident.getTableColumnMetadata(column)?.modelType;

      if (!modelType) {
        continue;
      }

      const resources: Array<BaseModel> = this.getIdsOf(
        alert.getColumnValue(column),
      ).map((id: string): BaseModel => {
        return this.toIdOnly(new modelType(), id);
      });

      if (resources.length > 0) {
        incident.setColumnValue(column, resources as never);
      }
    }

    const liveLabels: Array<Label> = (alert.labels || [])
      .filter((label: Label): boolean => {
        return !isArchivedValue(label);
      })
      .map((label: Label): Label => {
        return this.toIdOnly(new Label(), label._id || label.id);
      })
      .filter((label: Label): boolean => {
        return Boolean(label._id);
      });

    if (liveLabels.length > 0) {
      incident.labels = liveLabels;
    }

    if (alert.isPrivate === true) {
      incident.isPrivate = true;
    }

    incident.isVisibleOnStatusPage = rule.showIncidentOnStatusPage !== false;
    incident.isCreatedAutomatically = true;

    return incident;
  }

  /*
   * The incident's severity: the rule's, when it names one that is still
   * the project's; else the incident severity that corresponds to the
   * alert's - the same name, or the same place in the list
   * (IncidentFromAlerts.mapAlertSeverityToIncidentSeverity); else, for an
   * alert whose severity maps to none, the least severe of the project's
   * incident severities. Archived incident severities are never picked by
   * the mapping. Null only when the project has no incident severity.
   */
  private async getIncidentSeverityId(data: {
    alert: Alert;
    rule: AlertIncidentRule;
  }): Promise<ObjectID | null> {
    const { alert, rule } = data;

    const incidentSeverities: Array<IncidentSeverity> =
      await IncidentSeverityService.findBy({
        query: {
          projectId: alert.projectId!,
        },
        select: {
          _id: true,
          name: true,
          order: true,
          isArchived: true,
        },
        limit: LIMIT_PER_PROJECT,
        skip: 0,
        props: {
          isRoot: true,
        },
      });

    if (rule.incidentSeverityId) {
      const ruleSeverityId: string = rule.incidentSeverityId.toString();

      const isStillTheProjects: boolean = incidentSeverities.some(
        (severity: IncidentSeverity): boolean => {
          return severity._id?.toString() === ruleSeverityId;
        },
      );

      if (isStillTheProjects) {
        return new ObjectID(ruleSeverityId);
      }
    }

    const liveIncidentSeverities: Array<SeverityForMapping> =
      incidentSeverities
        .filter((severity: IncidentSeverity): boolean => {
          return !isArchivedValue(severity) && Boolean(severity._id);
        })
        .map((severity: IncidentSeverity): SeverityForMapping => {
          return this.toSeverityForMapping(severity);
        });

    if (liveIncidentSeverities.length === 0) {
      return null;
    }

    if (alert.alertSeverityId) {
      const alertSeverities: Array<AlertSeverity> =
        await AlertSeverityService.findBy({
          query: {
            projectId: alert.projectId!,
          },
          select: {
            _id: true,
            name: true,
            order: true,
          },
          limit: LIMIT_PER_PROJECT,
          skip: 0,
          props: {
            isRoot: true,
          },
        });

      const mappedId: string | null =
        IncidentFromAlerts.mapAlertSeverityToIncidentSeverity({
          alertSeverityId: alert.alertSeverityId.toString(),
          alertSeverities: alertSeverities.map(
            (severity: AlertSeverity): SeverityForMapping => {
              return this.toSeverityForMapping(severity);
            },
          ),
          incidentSeverities: liveIncidentSeverities,
        });

      if (mappedId) {
        return new ObjectID(mappedId);
      }
    }

    const sorted: Array<SeverityForMapping> =
      IncidentFromAlerts.sortSeveritiesByOrder(liveIncidentSeverities);

    return new ObjectID(sorted[sorted.length - 1]!.id);
  }

  /*
   * "🚨 Alert Incident Rule executed: <rule>" in the alert's feed, with the
   * incident it declared - by its number and link only, as the alert's
   * other entries name a linked incident that may be private - and, for a
   * rule that waited, how long the alert had stayed unresolved.
   */
  private async createRuleExecutedFeedItem(data: {
    alert: Alert;
    rule: AlertIncidentRule;
    incident: Incident;
  }): Promise<void> {
    const { alert, rule, incident } = data;

    try {
      const declared: Incident | null = await IncidentService.findOneById({
        id: incident.id!,
        select: {
          incidentNumber: true,
          incidentNumberWithPrefix: true,
        },
        props: {
          isRoot: true,
        },
      });

      const incidentNumber: string =
        declared?.incidentNumberWithPrefix ||
        (typeof declared?.incidentNumber === "number"
          ? `#${declared.incidentNumber}`
          : "");

      const incidentLabel: string = incidentNumber
        ? `Incident ${incidentNumber}`
        : "An incident";

      const incidentLink: string = (
        await IncidentService.getIncidentLinkInDashboard(
          alert.projectId!,
          incident.id!,
        )
      ).toString();

      const feedInfoInMarkdown: MarkdownText = mdText`${RuleFeedMarkdown.executedLine(
        {
          emoji: "🚨",
          ruleKind: ALERT_INCIDENT_RULE_KIND,
          ruleNames: [rule.name?.toString() || "Unnamed Rule"],
        },
      )}\n\n${getAlertIncidentRuleDeclaredSentence({
        incidentLabel: incidentLabel,
        incidentLink: incidentLink,
        declareAfterInMinutes: rule.declareAfterInMinutes,
      })}`;

      await AlertFeedService.createAlertFeedItem({
        alertId: alert.id!,
        projectId: alert.projectId!,
        alertFeedEventType: AlertFeedEventType.IncidentRuleExecuted,
        displayColor: Red500,
        feedInfoInMarkdown: feedInfoInMarkdown.toString(),
      });
    } catch (error) {
      logger.error(
        `AlertIncidentRuleEngine: failed to create rule-executed feed item: ${
          error instanceof Error ? error.message : String(error)
        }`,
        {
          projectId: alert.projectId?.toString(),
          alertId: alert.id?.toString(),
        } as LogAttributes,
      );
    }
  }

  @CaptureSpan()
  private async doesAlertMatchRule(
    alert: Alert,
    rule: AlertIncidentRule,
  ): Promise<boolean> {
    return await RuleCriteriaMatcher.matchesWithLegacy({
      rule,
      legacyFields: LEGACY_MATCH_FIELDS,
      emptyResult: true,
      matchesLegacyRule: async (
        legacyRule: AlertIncidentRule,
      ): Promise<boolean> => {
        return await this.doesAlertMatchLegacyRule(alert, legacyRule);
      },
    });
  }

  private async doesAlertMatchLegacyRule(
    alert: Alert,
    rule: AlertIncidentRule,
  ): Promise<boolean> {
    // Monitors: the alert must come from one of the rule's monitors.
    if (rule.monitors && rule.monitors.length > 0) {
      if (!alert.monitorId) {
        return false;
      }

      if (!this.getIdsOf(rule.monitors).includes(alert.monitorId.toString())) {
        return false;
      }
    }

    // Severity
    if (rule.alertSeverities && rule.alertSeverities.length > 0) {
      if (!alert.alertSeverityId) {
        return false;
      }

      if (
        !this.getIdsOf(rule.alertSeverities).includes(
          alert.alertSeverityId.toString(),
        )
      ) {
        return false;
      }
    }

    // Alert labels: any one of the rule's is enough.
    if (rule.alertLabels && rule.alertLabels.length > 0) {
      const alertLabelIds: Array<string> = this.getIdsOf(alert.labels);

      const hasMatch: boolean = this.getIdsOf(rule.alertLabels).some(
        (id: string): boolean => {
          return alertLabelIds.includes(id);
        },
      );

      if (!hasMatch) {
        return false;
      }
    }

    // Monitor-derived criteria
    const hasMonitorCriteria: boolean = Boolean(
      (rule.monitorLabels && rule.monitorLabels.length > 0) ||
        rule.monitorNamePattern ||
        rule.monitorDescriptionPattern,
    );

    if (hasMonitorCriteria) {
      if (!alert.monitorId) {
        return false;
      }

      const monitor: Monitor | null = await MonitorService.findOneById({
        id: alert.monitorId,
        select: {
          name: true,
          description: true,
          labels: { _id: true },
        },
        props: { isRoot: true },
      });

      if (!monitor) {
        return false;
      }

      if (rule.monitorLabels && rule.monitorLabels.length > 0) {
        const monitorLabelIds: Array<string> = this.getIdsOf(monitor.labels);

        const hasMatch: boolean = this.getIdsOf(rule.monitorLabels).some(
          (id: string): boolean => {
            return monitorLabelIds.includes(id);
          },
        );

        if (!hasMatch) {
          return false;
        }
      }

      if (rule.monitorNamePattern) {
        if (
          !monitor.name ||
          !this.testRegex(rule.monitorNamePattern, monitor.name, rule)
        ) {
          return false;
        }
      }

      if (rule.monitorDescriptionPattern) {
        if (
          !monitor.description ||
          !this.testRegex(
            rule.monitorDescriptionPattern,
            monitor.description,
            rule,
          )
        ) {
          return false;
        }
      }
    }

    if (rule.alertTitlePattern) {
      if (
        !alert.title ||
        !this.testRegex(rule.alertTitlePattern, alert.title, rule)
      ) {
        return false;
      }
    }

    if (rule.alertDescriptionPattern) {
      if (
        !alert.description ||
        !this.testRegex(rule.alertDescriptionPattern, alert.description, rule)
      ) {
        return false;
      }
    }

    return true;
  }

  private testRegex(
    pattern: string,
    value: string,
    rule: AlertIncidentRule,
  ): boolean {
    try {
      return RulePatternMatchUtil.testRegex(pattern, value);
    } catch {
      logger.warn(
        `Invalid regex pattern in alert incident rule ${rule.id}: ${pattern}`,
      );
      return false;
    }
  }

  // The ids of a list of records (models, or their JSON), as strings.
  private getIdsOf(value: unknown): Array<string> {
    if (!Array.isArray(value)) {
      return [];
    }

    const ids: Array<string> = [];

    for (const item of value) {
      const record: { _id?: unknown; id?: unknown } | null =
        item && typeof item === "object"
          ? (item as { _id?: unknown; id?: unknown })
          : null;

      const id: string = (record?._id || record?.id || "").toString();

      if (id && !ids.includes(id)) {
        ids.push(id);
      }
    }

    return ids;
  }

  private toIdOnly<T extends BaseModel>(
    model: T,
    id: ObjectID | string | null | undefined,
  ): T {
    if (id) {
      model._id = id.toString();
    }

    return model;
  }

  private toSeverityForMapping(
    severity: AlertSeverity | IncidentSeverity,
  ): SeverityForMapping {
    return {
      id: severity._id?.toString() || "",
      name: severity.name,
      order: severity.order,
    };
  }
}

export default new AlertIncidentRuleEngineServiceClass();

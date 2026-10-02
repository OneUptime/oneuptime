import Alert from "../../Models/DatabaseModels/Alert";
import DatabaseBaseModel from "../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Incident from "../../Models/DatabaseModels/Incident";
import Monitor from "../../Models/DatabaseModels/Monitor";
import Runbook from "../../Models/DatabaseModels/Runbook";
import RunbookExecution from "../../Models/DatabaseModels/RunbookExecution";
import RunbookRule from "../../Models/DatabaseModels/RunbookRule";
import ScheduledMaintenance from "../../Models/DatabaseModels/ScheduledMaintenance";
import { JSONArray } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import RunbookExecutionStatus from "../../Types/Runbook/RunbookExecutionStatus";
import RunbookRuleTriggerEntity from "../../Types/Runbook/RunbookRuleTriggerEntity";
import RunbookStepExecutionStatus from "../../Types/Runbook/RunbookStepExecutionStatus";
import { RunbookStep } from "../../Types/Runbook/RunbookStep";
import { RunbookStepExecutionState } from "../../Types/Runbook/RunbookStepExecution";
import RunbookExecutionService from "./RunbookExecutionService";
import RunbookRuleService from "./RunbookRuleService";
import RunbookService from "./RunbookService";
import Select from "../Types/Database/Select";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import logger, { LogAttributes } from "../Utils/Logger";
import { MAX_RULES_EVALUATED_PER_PROJECT } from "../../Utils/Rules/RuleEngineLimits";
import logIfRuleReadWasTruncated from "../Utils/Rules/RuleEngineRuleRead";
import MonitorRuleCriteriaCache from "../Utils/Rules/MonitorRuleCriteriaCache";
import RuleCriteriaMatcher, {
  LegacyFilterCorrelation,
} from "../../Utils/Rules/RuleCriteriaMatcher";

type EnqueueExecutionFn = (data: {
  runbookExecutionId: ObjectID;
}) => Promise<void>;

/*
 * What a runbook rule is matched against, read off the incident, alert or
 * scheduled maintenance event being created. The three differ only in where
 * these come from: an alert has one monitor where the others have a list, and
 * a scheduled maintenance event has no severity.
 */
interface RunbookRuleSubject {
  title: string | undefined;
  description: string | undefined;
  severityId: ObjectID | undefined;
  labelIds: Array<string>;
  monitorIds: Array<ObjectID>;
}

/*
 * The criteria evaluated per monitor: "a monitor named api-* labelled
 * production" means one monitor that is both, not one of each.
 */
const MONITOR_CORRELATED_FIELDS: Array<Extract<keyof RunbookRule, string>> = [
  "monitorLabels",
  "monitorNamePattern",
  "monitorDescriptionPattern",
];

type RuleSeveritiesGetter = (
  rule: RunbookRule,
) => Array<DatabaseBaseModel> | undefined;

type RuleMatcher = (rule: RunbookRule) => Promise<boolean>;

class RunbookRuleEngineServiceClass {
  // Lazily-set queue hook so Common doesn't depend on App/FeatureSet.
  private enqueue: EnqueueExecutionFn | null = null;

  /*
   * Everything a rule is matched on, whatever its trigger: a rule of one
   * trigger has nothing in another trigger's columns.
   */
  public readonly ruleSelect: Select<RunbookRule> = {
    _id: true,
    name: true,
    criteria: true,
    monitors: { _id: true },
    incidentSeverities: { _id: true },
    alertSeverities: { _id: true },
    labels: { _id: true },
    monitorLabels: { _id: true },
    titlePattern: true,
    descriptionPattern: true,
    monitorNamePattern: true,
    monitorDescriptionPattern: true,
    runbooks: { _id: true },
  };

  public registerExecutionEnqueuer(fn: EnqueueExecutionFn): void {
    this.enqueue = fn;
  }

  /*
   * The incident as the create hook holds it: its monitors and severity as
   * created, and its labels including the ones label rules just attached
   * (they run first and update incident.labels in memory).
   */
  @CaptureSpan()
  public async applyRulesToIncident(incident: Incident): Promise<void> {
    if (!incident.id || !incident.projectId) {
      return;
    }
    await this.applyRules({
      projectId: incident.projectId,
      triggerEntityType: RunbookRuleTriggerEntity.Incident,
      linkage: { incidentId: incident.id },
      matchesRule: (rule: RunbookRule): Promise<boolean> => {
        return this.doesIncidentMatchRule(incident, rule);
      },
    });
  }

  @CaptureSpan()
  public async applyRulesToAlert(alert: Alert): Promise<void> {
    if (!alert.id || !alert.projectId) {
      return;
    }
    await this.applyRules({
      projectId: alert.projectId,
      triggerEntityType: RunbookRuleTriggerEntity.Alert,
      linkage: { alertId: alert.id },
      matchesRule: (rule: RunbookRule): Promise<boolean> => {
        return this.doesAlertMatchRule(alert, rule);
      },
    });
  }

  @CaptureSpan()
  public async applyRulesToScheduledMaintenance(
    event: ScheduledMaintenance,
  ): Promise<void> {
    if (!event.id || !event.projectId) {
      return;
    }
    await this.applyRules({
      projectId: event.projectId,
      triggerEntityType: RunbookRuleTriggerEntity.ScheduledMaintenance,
      linkage: { scheduledMaintenanceId: event.id },
      matchesRule: (rule: RunbookRule): Promise<boolean> => {
        return this.doesScheduledMaintenanceMatchRule(event, rule);
      },
    });
  }

  @CaptureSpan()
  private async applyRules(data: {
    projectId: ObjectID;
    triggerEntityType: RunbookRuleTriggerEntity;
    linkage: {
      incidentId?: ObjectID;
      alertId?: ObjectID;
      scheduledMaintenanceId?: ObjectID;
    };
    matchesRule: RuleMatcher;
  }): Promise<void> {
    try {
      const rules: Array<RunbookRule> = await RunbookRuleService.findBy({
        query: {
          projectId: data.projectId,
          isEnabled: true,
          triggerEntityType: data.triggerEntityType,
        },
        props: { isRoot: true },
        select: this.ruleSelect,
        limit: MAX_RULES_EVALUATED_PER_PROJECT,
        skip: 0,
      });

      logIfRuleReadWasTruncated({
        ruleKind: "RunbookRule",
        projectId: data.projectId,
        rulesRead: rules.length,
      });

      if (rules.length === 0) {
        return;
      }

      const runbookIdsToStart: Set<string> = new Set<string>();
      const matchedRuleNames: Array<string> = [];

      for (const rule of rules) {
        const runbookIds: Array<string> = (rule.runbooks || [])
          .map((rb: Runbook) => {
            return rb.id?.toString() || "";
          })
          .filter((id: string) => {
            return id !== "";
          });

        // A rule with nothing to start is not worth matching.
        if (runbookIds.length === 0) {
          continue;
        }

        if (!(await this.matchesQuietly(rule, data.matchesRule))) {
          continue;
        }

        for (const id of runbookIds) {
          runbookIdsToStart.add(id);
        }
        if (rule.name) {
          matchedRuleNames.push(rule.name);
        }
      }

      if (runbookIdsToStart.size === 0) {
        return;
      }

      for (const runbookIdStr of runbookIdsToStart) {
        await this.startRunbookFor({
          projectId: data.projectId,
          runbookId: new ObjectID(runbookIdStr),
          linkage: data.linkage,
        });
      }

      logger.debug(
        `RunbookRuleEngine: started ${runbookIdsToStart.size} runbook(s) for ${data.triggerEntityType}`,
        {
          projectId: data.projectId.toString(),
          matchedRules: matchedRuleNames.join(", "),
        } as LogAttributes,
      );
    } catch (error) {
      logger.error(`Error applying runbook rules: ${error}`, {
        projectId: data.projectId?.toString(),
        triggerEntityType: data.triggerEntityType,
      } as LogAttributes);
    }
  }

  /*
   * One rule failing to evaluate (a monitor read that throws) skips that rule
   * only: the other rules' runbooks still start.
   */
  private async matchesQuietly(
    rule: RunbookRule,
    matchesRule: RuleMatcher,
  ): Promise<boolean> {
    try {
      return await matchesRule(rule);
    } catch (error) {
      logger.error(
        `RunbookRuleEngine: could not evaluate runbook rule ${rule.id}: ${error}`,
      );
      return false;
    }
  }

  /*
   * Matching. A rule saved with conditions is matched on them, all or any;
   * one saved before conditions existed is matched on its columns, every
   * filled one having to pass. Either way a rule with nothing to check
   * matches every record of its trigger.
   */
  public async doesIncidentMatchRule(
    incident: Incident,
    rule: RunbookRule,
  ): Promise<boolean> {
    const subject: RunbookRuleSubject = {
      title: incident.title,
      description: incident.description,
      severityId: incident.incidentSeverityId,
      labelIds: this.getIds(incident.labels),
      monitorIds: this.getObjectIds(incident.monitors),
    };
    const monitorCache: MonitorRuleCriteriaCache =
      new MonitorRuleCriteriaCache();
    const getSeverities: RuleSeveritiesGetter = (
      legacyRule: RunbookRule,
    ): Array<DatabaseBaseModel> | undefined => {
      return legacyRule.incidentSeverities;
    };

    return await RuleCriteriaMatcher.matchesWithLegacy({
      rule: rule,
      legacyFields: [
        "monitors",
        "incidentSeverities",
        "labels",
        "monitorLabels",
        "titlePattern",
        "descriptionPattern",
        "monitorNamePattern",
        "monitorDescriptionPattern",
      ],
      emptyResult: true,
      matchesLegacyRule: async (legacyRule: RunbookRule): Promise<boolean> => {
        return await this.doesSubjectMatchLegacyRule({
          subject: subject,
          rule: legacyRule,
          severities: getSeverities(legacyRule),
          monitorCache: monitorCache,
        });
      },
      correlation: this.getMonitorCorrelation({
        subject: subject,
        getSeverities: getSeverities,
        monitorCache: monitorCache,
      }),
    });
  }

  public async doesAlertMatchRule(
    alert: Alert,
    rule: RunbookRule,
  ): Promise<boolean> {
    const subject: RunbookRuleSubject = {
      title: alert.title,
      description: alert.description,
      severityId: alert.alertSeverityId,
      labelIds: this.getIds(alert.labels),
      // An alert has one monitor, not a list.
      monitorIds: alert.monitorId
        ? [new ObjectID(alert.monitorId.toString())]
        : [],
    };
    const monitorCache: MonitorRuleCriteriaCache =
      new MonitorRuleCriteriaCache();
    const getSeverities: RuleSeveritiesGetter = (
      legacyRule: RunbookRule,
    ): Array<DatabaseBaseModel> | undefined => {
      return legacyRule.alertSeverities;
    };

    return await RuleCriteriaMatcher.matchesWithLegacy({
      rule: rule,
      legacyFields: [
        "monitors",
        "alertSeverities",
        "labels",
        "monitorLabels",
        "titlePattern",
        "descriptionPattern",
        "monitorNamePattern",
        "monitorDescriptionPattern",
      ],
      emptyResult: true,
      matchesLegacyRule: async (legacyRule: RunbookRule): Promise<boolean> => {
        return await this.doesSubjectMatchLegacyRule({
          subject: subject,
          rule: legacyRule,
          severities: getSeverities(legacyRule),
          monitorCache: monitorCache,
        });
      },
      correlation: this.getMonitorCorrelation({
        subject: subject,
        getSeverities: getSeverities,
        monitorCache: monitorCache,
      }),
    });
  }

  public async doesScheduledMaintenanceMatchRule(
    event: ScheduledMaintenance,
    rule: RunbookRule,
  ): Promise<boolean> {
    const subject: RunbookRuleSubject = {
      title: event.title,
      description: event.description,
      severityId: undefined,
      labelIds: this.getIds(event.labels),
      monitorIds: this.getObjectIds(event.monitors),
    };
    const monitorCache: MonitorRuleCriteriaCache =
      new MonitorRuleCriteriaCache();
    // A scheduled maintenance event has no severity to match.
    const getSeverities: RuleSeveritiesGetter = (): undefined => {
      return undefined;
    };

    return await RuleCriteriaMatcher.matchesWithLegacy({
      rule: rule,
      legacyFields: [
        "monitors",
        "labels",
        "monitorLabels",
        "titlePattern",
        "descriptionPattern",
        "monitorNamePattern",
        "monitorDescriptionPattern",
      ],
      emptyResult: true,
      matchesLegacyRule: async (legacyRule: RunbookRule): Promise<boolean> => {
        return await this.doesSubjectMatchLegacyRule({
          subject: subject,
          rule: legacyRule,
          severities: getSeverities(legacyRule),
          monitorCache: monitorCache,
        });
      },
      correlation: this.getMonitorCorrelation({
        subject: subject,
        getSeverities: getSeverities,
        monitorCache: monitorCache,
      }),
    });
  }

  /*
   * Monitor conditions are checked one monitor at a time, so Match all
   * cannot be satisfied by two different monitors each meeting half of it.
   */
  private getMonitorCorrelation(data: {
    subject: RunbookRuleSubject;
    getSeverities: RuleSeveritiesGetter;
    monitorCache: MonitorRuleCriteriaCache;
  }): LegacyFilterCorrelation<RunbookRule, ObjectID> {
    return {
      fields: MONITOR_CORRELATED_FIELDS,
      getCandidates: (): Array<ObjectID> => {
        return data.subject.monitorIds;
      },
      matchesLegacyRuleForCandidate: async (
        legacyRule: RunbookRule,
        monitorId: ObjectID,
      ): Promise<boolean> => {
        return await this.doesSubjectMatchLegacyRule({
          subject: { ...data.subject, monitorIds: [monitorId] },
          rule: legacyRule,
          severities: data.getSeverities(legacyRule),
          monitorCache: data.monitorCache,
        });
      },
    };
  }

  /*
   * A rule's own columns, every filled one having to pass: the shape of a
   * rule saved before conditions existed, and of each single condition the
   * criteria matcher hands over in turn.
   */
  private async doesSubjectMatchLegacyRule(data: {
    subject: RunbookRuleSubject;
    rule: RunbookRule;
    // The rule's severities of the subject's kind, if it has one.
    severities: Array<DatabaseBaseModel> | undefined;
    monitorCache: MonitorRuleCriteriaCache;
  }): Promise<boolean> {
    const { subject, rule } = data;

    if (
      !this.includesAnyOf(
        rule.monitors,
        subject.monitorIds.map((monitorId: ObjectID): string => {
          return monitorId.toString();
        }),
      )
    ) {
      return false;
    }

    if (
      !this.includesAnyOf(
        data.severities,
        subject.severityId ? [subject.severityId.toString()] : [],
      )
    ) {
      return false;
    }

    if (!this.includesAnyOf(rule.labels, subject.labelIds)) {
      return false;
    }

    if (
      !(await this.doesAnyMonitorMatch({
        rule: rule,
        monitorIds: subject.monitorIds,
        monitorCache: data.monitorCache,
      }))
    ) {
      return false;
    }

    return (
      this.matchesPattern(rule.titlePattern, subject.title, rule) &&
      this.matchesPattern(rule.descriptionPattern, subject.description, rule)
    );
  }

  // A monitor of the subject that carries the labels and fits the patterns.
  private async doesAnyMonitorMatch(data: {
    rule: RunbookRule;
    monitorIds: Array<ObjectID>;
    monitorCache: MonitorRuleCriteriaCache;
  }): Promise<boolean> {
    const { rule } = data;
    const hasMonitorCriteria: boolean = Boolean(
      (rule.monitorLabels && rule.monitorLabels.length > 0) ||
        rule.monitorNamePattern ||
        rule.monitorDescriptionPattern,
    );

    if (!hasMonitorCriteria) {
      return true;
    }

    for (const monitorId of data.monitorIds) {
      const monitor: Monitor | null =
        await data.monitorCache.getMonitor(monitorId);

      if (!monitor) {
        continue;
      }

      if (
        this.includesAnyOf(rule.monitorLabels, this.getIds(monitor.labels)) &&
        this.matchesPattern(rule.monitorNamePattern, monitor.name, rule) &&
        this.matchesPattern(
          rule.monitorDescriptionPattern,
          monitor.description,
          rule,
        )
      ) {
        return true;
      }
    }

    return false;
  }

  // True when the rule picks none of these, or the subject has one of them.
  private includesAnyOf(
    ruleValues: Array<DatabaseBaseModel> | undefined,
    subjectIds: Array<string>,
  ): boolean {
    if (!ruleValues || ruleValues.length === 0) {
      return true;
    }

    const ruleIds: Array<string> = this.getIds(ruleValues);

    return subjectIds.some((id: string): boolean => {
      return ruleIds.includes(id);
    });
  }

  // True when the rule sets no pattern, or the text matches it.
  private matchesPattern(
    pattern: string | undefined,
    value: string | undefined,
    rule: RunbookRule,
  ): boolean {
    if (!pattern) {
      return true;
    }

    if (!value) {
      return false;
    }

    return this.testRegex(pattern, value, rule);
  }

  private getIds(items: Array<DatabaseBaseModel> | undefined): Array<string> {
    return this.getObjectIds(items).map((id: ObjectID): string => {
      return id.toString();
    });
  }

  private getObjectIds(
    items: Array<DatabaseBaseModel> | undefined,
  ): Array<ObjectID> {
    return (items || [])
      .map((item: DatabaseBaseModel): ObjectID | null => {
        if (item.id) {
          return item.id;
        }

        // A relation read back as a plain { _id } rather than a model.
        return item._id ? new ObjectID(item._id.toString()) : null;
      })
      .filter((id: ObjectID | null): id is ObjectID => {
        return id !== null;
      });
  }

  private testRegex(
    pattern: string,
    value: string,
    rule: RunbookRule,
  ): boolean {
    try {
      const regex: RegExp = new RegExp(pattern, "i");
      return regex.test(value);
    } catch {
      logger.warn(`Invalid regex in runbook rule ${rule.id}: ${pattern}`);
      return false;
    }
  }

  @CaptureSpan()
  public async startRunbookFor(data: {
    projectId: ObjectID;
    runbookId: ObjectID;
    linkage: {
      incidentId?: ObjectID;
      alertId?: ObjectID;
      scheduledMaintenanceId?: ObjectID;
    };
    triggeredByUserId?: ObjectID;
  }): Promise<RunbookExecution | null> {
    const runbook: Runbook | null = await RunbookService.findOneById({
      id: data.runbookId,
      select: {
        _id: true,
        projectId: true,
        name: true,
        steps: true,
        isEnabled: true,
      },
      props: { isRoot: true },
    });

    if (!runbook) {
      return null;
    }

    if (runbook.projectId?.toString() !== data.projectId.toString()) {
      return null;
    }

    if (runbook.isEnabled === false) {
      return null;
    }

    const steps: RunbookStep[] =
      (runbook.steps as unknown as RunbookStep[]) || [];

    if (steps.length === 0) {
      return null;
    }

    const stepExecutions: RunbookStepExecutionState[] = steps
      .slice()
      .sort((a: RunbookStep, b: RunbookStep) => {
        return a.order - b.order;
      })
      .map((step: RunbookStep) => {
        return {
          step,
          status: RunbookStepExecutionStatus.Pending,
        };
      });

    const execution: RunbookExecution = new RunbookExecution();
    execution.projectId = runbook.projectId;
    execution.runbookId = new ObjectID(runbook._id!);
    execution.runbookNameSnapshot = runbook.name || "Runbook";
    execution.status = RunbookExecutionStatus.Scheduled;
    execution.stepExecutions = stepExecutions as unknown as JSONArray;
    if (data.linkage.incidentId) {
      execution.incidentId = data.linkage.incidentId;
    }
    if (data.linkage.alertId) {
      execution.alertId = data.linkage.alertId;
    }
    if (data.linkage.scheduledMaintenanceId) {
      execution.scheduledMaintenanceId = data.linkage.scheduledMaintenanceId;
    }
    if (data.triggeredByUserId) {
      execution.triggeredByUserId = data.triggeredByUserId;
    }

    const created: RunbookExecution = await RunbookExecutionService.create({
      data: execution,
      props: { isRoot: true },
    });

    if (this.enqueue) {
      try {
        await this.enqueue({
          runbookExecutionId: new ObjectID(created._id!),
        });
      } catch (err) {
        logger.error(
          `RunbookRuleEngine: failed to enqueue runbook execution: ${err}`,
          {
            runbookExecutionId: created._id?.toString(),
          } as LogAttributes,
        );
      }
    } else {
      logger.warn(
        "RunbookRuleEngine: enqueue hook not registered; execution created but not started.",
      );
    }

    return created;
  }
}

const RunbookRuleEngineService: RunbookRuleEngineServiceClass =
  new RunbookRuleEngineServiceClass();

export default RunbookRuleEngineService;

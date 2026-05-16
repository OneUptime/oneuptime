import Alert from "../../Models/DatabaseModels/Alert";
import Incident from "../../Models/DatabaseModels/Incident";
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
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import logger, { LogAttributes } from "../Utils/Logger";

type EnqueueExecutionFn = (data: {
  runbookExecutionId: ObjectID;
}) => Promise<void>;

class RunbookRuleEngineServiceClass {
  // Lazily-set queue hook so Common doesn't depend on App/FeatureSet.
  private enqueue: EnqueueExecutionFn | null = null;

  public registerExecutionEnqueuer(fn: EnqueueExecutionFn): void {
    this.enqueue = fn;
  }

  @CaptureSpan()
  public async applyRulesToIncident(incident: Incident): Promise<void> {
    if (!incident.id || !incident.projectId) {
      return;
    }
    await this.applyRules({
      projectId: incident.projectId,
      triggerEntityType: RunbookRuleTriggerEntity.Incident,
      title: incident.title,
      description: incident.description,
      linkage: { incidentId: incident.id },
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
      title: alert.title,
      description: alert.description,
      linkage: { alertId: alert.id },
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
      title: event.title,
      description: event.description,
      linkage: { scheduledMaintenanceId: event.id },
    });
  }

  @CaptureSpan()
  private async applyRules(data: {
    projectId: ObjectID;
    triggerEntityType: RunbookRuleTriggerEntity;
    title?: string | undefined;
    description?: string | undefined;
    linkage: {
      incidentId?: ObjectID;
      alertId?: ObjectID;
      scheduledMaintenanceId?: ObjectID;
    };
  }): Promise<void> {
    try {
      const rules: Array<RunbookRule> = await RunbookRuleService.findBy({
        query: {
          projectId: data.projectId,
          isEnabled: true,
          triggerEntityType: data.triggerEntityType,
        },
        props: { isRoot: true },
        select: {
          _id: true,
          name: true,
          titlePattern: true,
          descriptionPattern: true,
          runbooks: { _id: true },
        },
        limit: 100,
        skip: 0,
      });

      if (rules.length === 0) {
        return;
      }

      const runbookIdsToStart: Set<string> = new Set<string>();
      const matchedRuleNames: Array<string> = [];

      for (const rule of rules) {
        if (!this.matches(rule, data.title, data.description)) {
          continue;
        }
        const runbookIds: Array<string> = (rule.runbooks || [])
          .map((rb: Runbook) => {
            return rb.id?.toString() || "";
          })
          .filter((id: string) => {
            return id !== "";
          });
        if (runbookIds.length === 0) {
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

  private matches(
    rule: RunbookRule,
    title: string | undefined,
    description: string | undefined,
  ): boolean {
    if (rule.titlePattern) {
      if (!title || !this.testRegex(rule.titlePattern, title, rule)) {
        return false;
      }
    }
    if (rule.descriptionPattern) {
      if (
        !description ||
        !this.testRegex(rule.descriptionPattern, description, rule)
      ) {
        return false;
      }
    }
    return true;
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

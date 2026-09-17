import Label from "../../Models/DatabaseModels/Label";
import OnCallDutyPolicySchedule from "../../Models/DatabaseModels/OnCallDutyPolicySchedule";
import OnCallDutyPolicyScheduleLabelRule from "../../Models/DatabaseModels/OnCallDutyPolicyScheduleLabelRule";
import OnCallDutyPolicyScheduleLabelRuleService from "./OnCallDutyPolicyScheduleLabelRuleService";
import OnCallDutyPolicyScheduleService from "./OnCallDutyPolicyScheduleService";
import ObjectID from "../../Types/ObjectID";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import logger, { LogAttributes } from "../Utils/Logger";
import { MAX_RULES_EVALUATED_PER_PROJECT } from "../../Utils/Rules/RuleEngineLimits";
import { RuleCriteriaMatcher } from "../../Utils/Rules/RuleCriteriaMatcher";
import logIfRuleReadWasTruncated from "../Utils/Rules/RuleEngineRuleRead";
import Select from "../Types/Database/Select";
import {
  ApplyRulesToExistingResourceData,
  RuleApplicationResult,
  RuleApplicationResultUtil,
  RuleRunEngine,
} from "../Utils/Rules/RuleRun/RuleApplication";

class OnCallDutyPolicyScheduleLabelRuleEngineServiceClass
  implements
    RuleRunEngine<OnCallDutyPolicySchedule, OnCallDutyPolicyScheduleLabelRule>
{
  public readonly ruleSelect: Select<OnCallDutyPolicyScheduleLabelRule> = {
    _id: true,
    name: true,
    criteria: true,
    onCallDutyPolicyScheduleLabels: { _id: true },
    onCallDutyPolicyScheduleNamePattern: true,
    onCallDutyPolicyScheduleDescriptionPattern: true,
    labelsToAdd: { _id: true },
  };

  /*
   * Evaluation re-reads the on-call duty schedule, so a run only has to name
   * it.
   */
  public readonly resourceSelectForRuleRun: Select<OnCallDutyPolicySchedule> = {
    _id: true,
    projectId: true,
  };

  @CaptureSpan()
  public async applyRulesToSchedule(
    schedule: OnCallDutyPolicySchedule,
  ): Promise<void> {
    if (!schedule.id || !schedule.projectId) {
      return;
    }

    try {
      const rules: Array<OnCallDutyPolicyScheduleLabelRule> =
        await OnCallDutyPolicyScheduleLabelRuleService.findBy({
          query: {
            projectId: schedule.projectId,
            isEnabled: true,
          },
          props: { isRoot: true },
          select: this.ruleSelect,
          limit: MAX_RULES_EVALUATED_PER_PROJECT,
          skip: 0,
        });

      logIfRuleReadWasTruncated({
        ruleKind: "OnCallDutyPolicyScheduleLabelRule",
        projectId: schedule.projectId,
        rulesRead: rules.length,
      });

      if (rules.length === 0) {
        return;
      }

      await this.applyRules({ schedule: schedule, rules: rules });
    } catch (error) {
      logger.error(
        `Error applying on-call duty schedule label rules: ${error}`,
        {
          projectId: schedule.projectId?.toString(),
          onCallDutyPolicyScheduleId: schedule.id?.toString(),
        } as LogAttributes,
      );
    }
  }

  /*
   * "Run now": the same evaluation, for an on-call duty schedule that already
   * exists and only the rules being run.
   */
  @CaptureSpan()
  public async applyRulesToExistingResource(
    data: ApplyRulesToExistingResourceData<
      OnCallDutyPolicySchedule,
      OnCallDutyPolicyScheduleLabelRule
    >,
  ): Promise<RuleApplicationResult> {
    try {
      return await this.applyRules({
        schedule: data.resource,
        rules: data.rules,
      });
    } catch (error) {
      logger.error(
        `Error running on-call duty schedule label rules: ${error}`,
        {
          projectId: data.resource.projectId?.toString(),
          onCallDutyPolicyScheduleId: data.resource.id?.toString(),
        } as LogAttributes,
      );

      return RuleApplicationResultUtil.failed();
    }
  }

  private async applyRules(data: {
    schedule: OnCallDutyPolicySchedule;
    rules: Array<OnCallDutyPolicyScheduleLabelRule>;
  }): Promise<RuleApplicationResult> {
    const { schedule, rules } = data;

    if (!schedule.id || !schedule.projectId || rules.length === 0) {
      return RuleApplicationResultUtil.noMatch();
    }

    const scheduleWithDetails: OnCallDutyPolicySchedule | null =
      await OnCallDutyPolicyScheduleService.findOneById({
        id: schedule.id,
        select: {
          name: true,
          description: true,
          labels: { _id: true },
        },
        props: { isRoot: true },
      });

    if (!scheduleWithDetails) {
      return RuleApplicationResultUtil.noMatch();
    }

    const labelIdsToAdd: Set<string> = new Set();
    let matchedAnyRule: boolean = false;

    for (const rule of rules) {
      const matches: boolean = this.doesScheduleMatchRule(
        scheduleWithDetails,
        rule,
      );
      if (!matches) {
        continue;
      }
      matchedAnyRule = true;
      for (const label of rule.labelsToAdd || []) {
        if (label.id) {
          labelIdsToAdd.add(label.id.toString());
        }
      }
    }

    if (!matchedAnyRule) {
      return RuleApplicationResultUtil.noMatch();
    }

    if (labelIdsToAdd.size === 0) {
      return RuleApplicationResultUtil.alreadyApplied();
    }

    const existingLabelIds: Set<string> = new Set(
      (scheduleWithDetails.labels || [])
        .map((l: Label) => {
          return l.id?.toString() || "";
        })
        .filter((id: string) => {
          return id !== "";
        }),
    );

    const newLabelIds: Array<string> = Array.from(labelIdsToAdd).filter(
      (id: string) => {
        return !existingLabelIds.has(id);
      },
    );
    if (newLabelIds.length === 0) {
      return RuleApplicationResultUtil.alreadyApplied();
    }

    await OnCallDutyPolicyScheduleService.getRepository()
      .createQueryBuilder()
      .relation(OnCallDutyPolicySchedule, "labels")
      .of(schedule.id.toString())
      .add(newLabelIds);

    const mergedLabelIds: Set<string> = new Set([
      ...existingLabelIds,
      ...newLabelIds,
    ]);
    schedule.labels = Array.from(mergedLabelIds).map((id: string) => {
      const label: Label = new Label();
      label.id = new ObjectID(id);
      return label;
    });

    logger.debug(
      `OnCallDutyPolicyScheduleLabelRuleEngine attached ${newLabelIds.length} labels to schedule ${schedule.id}`,
      { projectId: schedule.projectId.toString() } as LogAttributes,
    );

    return RuleApplicationResultUtil.updated(newLabelIds.length);
  }

  private doesScheduleMatchRule(
    schedule: OnCallDutyPolicySchedule,
    rule: OnCallDutyPolicyScheduleLabelRule,
  ): boolean {
    return RuleCriteriaMatcher.matchesWithLegacySync({
      rule: rule,
      legacyFields: [
        "onCallDutyPolicyScheduleLabels",
        "onCallDutyPolicyScheduleNamePattern",
        "onCallDutyPolicyScheduleDescriptionPattern",
      ],
      emptyResult: true,
      matchesLegacyRule: (
        scheduleRule: OnCallDutyPolicyScheduleLabelRule,
      ): boolean => {
        return this.doesScheduleMatchRuleLegacy(schedule, scheduleRule);
      },
    });
  }

  private doesScheduleMatchRuleLegacy(
    schedule: OnCallDutyPolicySchedule,
    rule: OnCallDutyPolicyScheduleLabelRule,
  ): boolean {
    if (
      rule.onCallDutyPolicyScheduleLabels &&
      rule.onCallDutyPolicyScheduleLabels.length > 0
    ) {
      if (!schedule.labels || schedule.labels.length === 0) {
        return false;
      }
      const ruleLabelIds: Array<string> =
        rule.onCallDutyPolicyScheduleLabels.map((l: Label) => {
          return l.id?.toString() || "";
        });
      const labelIds: Array<string> = schedule.labels.map((l: Label) => {
        return l.id?.toString() || "";
      });
      if (
        !ruleLabelIds.some((id: string) => {
          return labelIds.includes(id);
        })
      ) {
        return false;
      }
    }

    if (
      rule.onCallDutyPolicyScheduleNamePattern &&
      (!schedule.name ||
        !this.testRegex(
          rule.onCallDutyPolicyScheduleNamePattern,
          schedule.name,
          rule,
        ))
    ) {
      return false;
    }

    if (
      rule.onCallDutyPolicyScheduleDescriptionPattern &&
      (!schedule.description ||
        !this.testRegex(
          rule.onCallDutyPolicyScheduleDescriptionPattern,
          schedule.description,
          rule,
        ))
    ) {
      return false;
    }

    return true;
  }

  private testRegex(
    pattern: string,
    value: string,
    rule: OnCallDutyPolicyScheduleLabelRule,
  ): boolean {
    try {
      const regex: RegExp = new RegExp(pattern, "i");
      return regex.test(value);
    } catch {
      logger.warn(
        `Invalid regex in on-call duty schedule label rule ${rule.id}: ${pattern}`,
      );
      return false;
    }
  }
}

export default new OnCallDutyPolicyScheduleLabelRuleEngineServiceClass();

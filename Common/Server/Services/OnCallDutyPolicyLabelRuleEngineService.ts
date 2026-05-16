import Label from "../../Models/DatabaseModels/Label";
import OnCallDutyPolicy from "../../Models/DatabaseModels/OnCallDutyPolicy";
import OnCallDutyPolicyLabelRule from "../../Models/DatabaseModels/OnCallDutyPolicyLabelRule";
import OnCallDutyPolicyLabelRuleService from "./OnCallDutyPolicyLabelRuleService";
import OnCallDutyPolicyService from "./OnCallDutyPolicyService";
import ObjectID from "../../Types/ObjectID";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import logger, { LogAttributes } from "../Utils/Logger";

class OnCallDutyPolicyLabelRuleEngineServiceClass {
  @CaptureSpan()
  public async applyRulesToOnCallDutyPolicy(
    onCallDutyPolicy: OnCallDutyPolicy,
  ): Promise<void> {
    if (!onCallDutyPolicy.id || !onCallDutyPolicy.projectId) {
      return;
    }

    try {
      const rules: Array<OnCallDutyPolicyLabelRule> =
        await OnCallDutyPolicyLabelRuleService.findBy({
          query: {
            projectId: onCallDutyPolicy.projectId,
            isEnabled: true,
          },
          props: { isRoot: true },
          select: {
            _id: true,
            name: true,
            onCallDutyPolicyLabels: { _id: true },
            onCallDutyPolicyNamePattern: true,
            onCallDutyPolicyDescriptionPattern: true,
            labelsToAdd: { _id: true },
          },
          limit: 100,
          skip: 0,
        });

      if (rules.length === 0) {
        return;
      }

      const policyWithDetails: OnCallDutyPolicy | null =
        await OnCallDutyPolicyService.findOneById({
          id: onCallDutyPolicy.id,
          select: {
            name: true,
            description: true,
            labels: { _id: true },
          },
          props: { isRoot: true },
        });

      if (!policyWithDetails) {
        return;
      }

      const labelIdsToAdd: Set<string> = new Set();

      for (const rule of rules) {
        const matches: boolean = this.doesPolicyMatchRule(
          policyWithDetails,
          rule,
        );
        if (!matches) {
          continue;
        }
        for (const label of rule.labelsToAdd || []) {
          if (label.id) {
            labelIdsToAdd.add(label.id.toString());
          }
        }
      }

      if (labelIdsToAdd.size === 0) {
        return;
      }

      const existingLabelIds: Set<string> = new Set(
        (policyWithDetails.labels || [])
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
        return;
      }

      await OnCallDutyPolicyService.getRepository()
        .createQueryBuilder()
        .relation(OnCallDutyPolicy, "labels")
        .of(onCallDutyPolicy.id.toString())
        .add(newLabelIds);

      const mergedLabelIds: Set<string> = new Set([
        ...existingLabelIds,
        ...newLabelIds,
      ]);
      onCallDutyPolicy.labels = Array.from(mergedLabelIds).map((id: string) => {
        const label: Label = new Label();
        label.id = new ObjectID(id);
        return label;
      });

      logger.debug(
        `OnCallDutyPolicyLabelRuleEngine attached ${newLabelIds.length} labels to policy ${onCallDutyPolicy.id}`,
        { projectId: onCallDutyPolicy.projectId.toString() } as LogAttributes,
      );
    } catch (error) {
      logger.error(`Error applying on-call duty policy label rules: ${error}`, {
        projectId: onCallDutyPolicy.projectId?.toString(),
        onCallDutyPolicyId: onCallDutyPolicy.id?.toString(),
      } as LogAttributes);
    }
  }

  private doesPolicyMatchRule(
    policy: OnCallDutyPolicy,
    rule: OnCallDutyPolicyLabelRule,
  ): boolean {
    if (rule.onCallDutyPolicyLabels && rule.onCallDutyPolicyLabels.length > 0) {
      if (!policy.labels || policy.labels.length === 0) {
        return false;
      }
      const ruleLabelIds: Array<string> = rule.onCallDutyPolicyLabels.map(
        (l: Label) => {
          return l.id?.toString() || "";
        },
      );
      const labelIds: Array<string> = policy.labels.map((l: Label) => {
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
      rule.onCallDutyPolicyNamePattern &&
      (!policy.name ||
        !this.testRegex(rule.onCallDutyPolicyNamePattern, policy.name, rule))
    ) {
      return false;
    }

    if (
      rule.onCallDutyPolicyDescriptionPattern &&
      (!policy.description ||
        !this.testRegex(
          rule.onCallDutyPolicyDescriptionPattern,
          policy.description,
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
    rule: OnCallDutyPolicyLabelRule,
  ): boolean {
    try {
      const regex: RegExp = new RegExp(pattern, "i");
      return regex.test(value);
    } catch {
      logger.warn(
        `Invalid regex in on-call duty policy label rule ${rule.id}: ${pattern}`,
      );
      return false;
    }
  }
}

export default new OnCallDutyPolicyLabelRuleEngineServiceClass();

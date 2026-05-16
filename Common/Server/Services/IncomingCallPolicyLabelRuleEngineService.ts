import Label from "../../Models/DatabaseModels/Label";
import IncomingCallPolicy from "../../Models/DatabaseModels/IncomingCallPolicy";
import IncomingCallPolicyLabelRule from "../../Models/DatabaseModels/IncomingCallPolicyLabelRule";
import IncomingCallPolicyLabelRuleService from "./IncomingCallPolicyLabelRuleService";
import IncomingCallPolicyService from "./IncomingCallPolicyService";
import ObjectID from "../../Types/ObjectID";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import logger, { LogAttributes } from "../Utils/Logger";

class IncomingCallPolicyLabelRuleEngineServiceClass {
  @CaptureSpan()
  public async applyRulesToIncomingCallPolicy(
    policy: IncomingCallPolicy,
  ): Promise<void> {
    if (!policy.id || !policy.projectId) {
      return;
    }

    try {
      const rules: Array<IncomingCallPolicyLabelRule> =
        await IncomingCallPolicyLabelRuleService.findBy({
          query: {
            projectId: policy.projectId,
            isEnabled: true,
          },
          props: { isRoot: true },
          select: {
            _id: true,
            name: true,
            incomingCallPolicyLabels: { _id: true },
            incomingCallPolicyNamePattern: true,
            incomingCallPolicyDescriptionPattern: true,
            labelsToAdd: { _id: true },
          },
          limit: 100,
          skip: 0,
        });

      if (rules.length === 0) {
        return;
      }

      const policyWithDetails: IncomingCallPolicy | null =
        await IncomingCallPolicyService.findOneById({
          id: policy.id,
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

      await IncomingCallPolicyService.getRepository()
        .createQueryBuilder()
        .relation(IncomingCallPolicy, "labels")
        .of(policy.id.toString())
        .add(newLabelIds);

      const mergedLabelIds: Set<string> = new Set([
        ...existingLabelIds,
        ...newLabelIds,
      ]);
      policy.labels = Array.from(mergedLabelIds).map((id: string) => {
        const label: Label = new Label();
        label.id = new ObjectID(id);
        return label;
      });

      logger.debug(
        `IncomingCallPolicyLabelRuleEngine attached ${newLabelIds.length} labels to policy ${policy.id}`,
        { projectId: policy.projectId.toString() } as LogAttributes,
      );
    } catch (error) {
      logger.error(
        `Error applying incoming call policy label rules: ${error}`,
        {
          projectId: policy.projectId?.toString(),
          incomingCallPolicyId: policy.id?.toString(),
        } as LogAttributes,
      );
    }
  }

  private doesPolicyMatchRule(
    policy: IncomingCallPolicy,
    rule: IncomingCallPolicyLabelRule,
  ): boolean {
    if (
      rule.incomingCallPolicyLabels &&
      rule.incomingCallPolicyLabels.length > 0
    ) {
      if (!policy.labels || policy.labels.length === 0) {
        return false;
      }
      const ruleLabelIds: Array<string> = rule.incomingCallPolicyLabels.map(
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
      rule.incomingCallPolicyNamePattern &&
      (!policy.name ||
        !this.testRegex(rule.incomingCallPolicyNamePattern, policy.name, rule))
    ) {
      return false;
    }

    if (
      rule.incomingCallPolicyDescriptionPattern &&
      (!policy.description ||
        !this.testRegex(
          rule.incomingCallPolicyDescriptionPattern,
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
    rule: IncomingCallPolicyLabelRule,
  ): boolean {
    try {
      const regex: RegExp = new RegExp(pattern, "i");
      return regex.test(value);
    } catch {
      logger.warn(
        `Invalid regex in incoming call policy label rule ${rule.id}: ${pattern}`,
      );
      return false;
    }
  }
}

export default new IncomingCallPolicyLabelRuleEngineServiceClass();

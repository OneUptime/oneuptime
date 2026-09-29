import Label from "../../Models/DatabaseModels/Label";
import IncomingCallPolicy from "../../Models/DatabaseModels/IncomingCallPolicy";
import IncomingCallPolicyLabelRule from "../../Models/DatabaseModels/IncomingCallPolicyLabelRule";
import IncomingCallPolicyLabelRuleService from "./IncomingCallPolicyLabelRuleService";
import IncomingCallPolicyService from "./IncomingCallPolicyService";
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

class IncomingCallPolicyLabelRuleEngineServiceClass
  implements RuleRunEngine<IncomingCallPolicy, IncomingCallPolicyLabelRule>
{
  public readonly ruleSelect: Select<IncomingCallPolicyLabelRule> = {
    _id: true,
    name: true,
    criteria: true,
    incomingCallPolicyLabels: { _id: true },
    incomingCallPolicyNamePattern: true,
    incomingCallPolicyDescriptionPattern: true,
    labelsToAdd: { _id: true },
  };

  // Evaluation re-reads the incoming call policy, so a run only has to name it.
  public readonly resourceSelectForRuleRun: Select<IncomingCallPolicy> = {
    _id: true,
    projectId: true,
  };

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
          select: this.ruleSelect,
          limit: MAX_RULES_EVALUATED_PER_PROJECT,
          skip: 0,
        });

      logIfRuleReadWasTruncated({
        ruleKind: "IncomingCallPolicyLabelRule",
        projectId: policy.projectId,
        rulesRead: rules.length,
      });

      if (rules.length === 0) {
        return;
      }

      await this.applyRules({ policy: policy, rules: rules });
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

  /*
   * "Run now": the same evaluation, for an incoming call policy that already
   * exists and only the rules being run.
   */
  @CaptureSpan()
  public async applyRulesToExistingResource(
    data: ApplyRulesToExistingResourceData<
      IncomingCallPolicy,
      IncomingCallPolicyLabelRule
    >,
  ): Promise<RuleApplicationResult> {
    try {
      return await this.applyRules({
        policy: data.resource,
        rules: data.rules,
      });
    } catch (error) {
      logger.error(`Error running incoming call policy label rules: ${error}`, {
        projectId: data.resource.projectId?.toString(),
        incomingCallPolicyId: data.resource.id?.toString(),
      } as LogAttributes);

      return RuleApplicationResultUtil.failed();
    }
  }

  private async applyRules(data: {
    policy: IncomingCallPolicy;
    rules: Array<IncomingCallPolicyLabelRule>;
  }): Promise<RuleApplicationResult> {
    const { policy, rules } = data;

    if (!policy.id || !policy.projectId || rules.length === 0) {
      return RuleApplicationResultUtil.noMatch();
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
      return RuleApplicationResultUtil.noMatch();
    }

    const labelIdsToAdd: Set<string> = new Set();
    let matchedAnyRule: boolean = false;

    for (const rule of rules) {
      const matches: boolean = this.doesPolicyMatchRule(
        policyWithDetails,
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
      return RuleApplicationResultUtil.alreadyApplied();
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

    return RuleApplicationResultUtil.updated(newLabelIds.length);
  }

  private doesPolicyMatchRule(
    policy: IncomingCallPolicy,
    rule: IncomingCallPolicyLabelRule,
  ): boolean {
    return RuleCriteriaMatcher.matchesWithLegacySync({
      rule,
      legacyFields: [
        "incomingCallPolicyLabels",
        "incomingCallPolicyNamePattern",
        "incomingCallPolicyDescriptionPattern",
      ],
      emptyResult: true,
      matchesLegacyRule: (legacyRule: IncomingCallPolicyLabelRule): boolean => {
        return this.doesPolicyMatchLegacyRule(policy, legacyRule);
      },
    });
  }

  private doesPolicyMatchLegacyRule(
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

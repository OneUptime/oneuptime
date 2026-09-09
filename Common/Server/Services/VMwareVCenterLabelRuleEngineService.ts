import Label from "../../Models/DatabaseModels/Label";
import VMwareVCenter from "../../Models/DatabaseModels/VMwareVCenter";
import VMwareVCenterLabelRule from "../../Models/DatabaseModels/VMwareVCenterLabelRule";
import VMwareVCenterLabelRuleService from "./VMwareVCenterLabelRuleService";
import VMwareVCenterService from "./VMwareVCenterService";
import VMwareVCenterFeedService from "./VMwareVCenterFeedService";
import { VMwareVCenterFeedEventType } from "../../Models/DatabaseModels/VMwareVCenterFeed";
import { Purple500 } from "../../Types/BrandColors";
import ObjectID from "../../Types/ObjectID";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import logger, { LogAttributes } from "../Utils/Logger";
import { MAX_RULES_EVALUATED_PER_PROJECT } from "../../Utils/Rules/RuleEngineLimits";
import logIfRuleReadWasTruncated from "../Utils/Rules/RuleEngineRuleRead";

class VMwareVCenterLabelRuleEngineServiceClass {
  /**
   * Evaluates VMwareVCenterLabelRule rows for the given vCenter and attaches
   * matched labels to it. The union is deduped against labels already on the
   * vCenter before insert to avoid PK conflicts on the join table.
   */
  @CaptureSpan()
  public async applyRulesToVMwareVCenter(
    vmwareVCenter: VMwareVCenter,
  ): Promise<void> {
    if (!vmwareVCenter.id || !vmwareVCenter.projectId) {
      return;
    }

    try {
      const rules: Array<VMwareVCenterLabelRule> =
        await VMwareVCenterLabelRuleService.findBy({
          query: {
            projectId: vmwareVCenter.projectId,
            isEnabled: true,
          },
          props: { isRoot: true },
          select: {
            _id: true,
            name: true,
            vmwareVCenterLabels: { _id: true },
            vmwareVCenterNamePattern: true,
            vmwareVCenterDescriptionPattern: true,
            labelsToAdd: { _id: true },
          },
          limit: MAX_RULES_EVALUATED_PER_PROJECT,
          skip: 0,
        });

      logIfRuleReadWasTruncated({
        ruleKind: "VMwareVCenterLabelRule",
        projectId: vmwareVCenter.projectId,
        rulesRead: rules.length,
      });

      if (rules.length === 0) {
        return;
      }

      const vmwareVCenterWithDetails: VMwareVCenter | null =
        await VMwareVCenterService.findOneById({
          id: vmwareVCenter.id,
          select: {
            name: true,
            description: true,
            labels: { _id: true },
          },
          props: { isRoot: true },
        });

      if (!vmwareVCenterWithDetails) {
        return;
      }

      const labelIdsToAdd: Set<string> = new Set();
      const matchedRuleNames: Array<string> = [];

      for (const rule of rules) {
        const matches: boolean = this.doesVMwareVCenterMatchRule(
          vmwareVCenterWithDetails,
          rule,
        );
        if (!matches) {
          continue;
        }
        if ((rule.labelsToAdd || []).length > 0) {
          matchedRuleNames.push(
            rule.name || rule.id?.toString() || "Unnamed rule",
          );
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
        (vmwareVCenterWithDetails.labels || [])
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

      await VMwareVCenterService.getRepository()
        .createQueryBuilder()
        .relation(VMwareVCenter, "labels")
        .of(vmwareVCenter.id.toString())
        .add(newLabelIds);

      /*
       * Sync in-memory vmwareVCenter.labels so a downstream owner-rule engine
       * in the same onCreateSuccess chain can match on rule-added labels.
       */
      const mergedLabelIds: Set<string> = new Set([
        ...existingLabelIds,
        ...newLabelIds,
      ]);
      vmwareVCenter.labels = Array.from(mergedLabelIds).map((id: string) => {
        const label: Label = new Label();
        label.id = new ObjectID(id);
        return label;
      });

      logger.debug(
        `VMwareVCenterLabelRuleEngine attached ${newLabelIds.length} labels to vCenter ${vmwareVCenter.id}`,
        { projectId: vmwareVCenter.projectId.toString() } as LogAttributes,
      );
      /*
       * Labels arriving from a rule rather than from a person is exactly the
       * kind of thing the overview page cannot explain, so record which rules
       * did it.
       */
      await VMwareVCenterFeedService.createVMwareVCenterFeedItem({
        vmwareVCenterId: vmwareVCenter.id,
        projectId: vmwareVCenter.projectId,
        vmwareVCenterFeedEventType:
          VMwareVCenterFeedEventType.LabelRuleExecuted,
        displayColor: Purple500,
        feedInfoInMarkdown: `🏷️ ${newLabelIds.length} label(s) were attached to ${await VMwareVCenterService.getVMwareVCenterMarkdownLink(
          vmwareVCenter.projectId,
          vmwareVCenter.id,
        )} by label ${matchedRuleNames.length === 1 ? "rule" : "rules"}.`,
        moreInformationInMarkdown: `**Label rules that matched**: ${matchedRuleNames
          .map((name: string) => {
            return `\`${name}\``;
          })
          .join(", ")}`,
      });
    } catch (error) {
      logger.error(`Error applying vCenter label rules: ${error}`, {
        projectId: vmwareVCenter.projectId?.toString(),
        vmwareVCenterId: vmwareVCenter.id?.toString(),
      } as LogAttributes);
    }
  }

  private doesVMwareVCenterMatchRule(
    vmwareVCenter: VMwareVCenter,
    rule: VMwareVCenterLabelRule,
  ): boolean {
    if (rule.vmwareVCenterLabels && rule.vmwareVCenterLabels.length > 0) {
      if (!vmwareVCenter.labels || vmwareVCenter.labels.length === 0) {
        return false;
      }
      const ruleLabelIds: Array<string> = rule.vmwareVCenterLabels.map(
        (l: Label) => {
          return l.id?.toString() || "";
        },
      );
      const labelIds: Array<string> = vmwareVCenter.labels.map((l: Label) => {
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
      rule.vmwareVCenterNamePattern &&
      (!vmwareVCenter.name ||
        !this.testRegex(
          rule.vmwareVCenterNamePattern,
          vmwareVCenter.name,
          rule,
        ))
    ) {
      return false;
    }

    if (
      rule.vmwareVCenterDescriptionPattern &&
      (!vmwareVCenter.description ||
        !this.testRegex(
          rule.vmwareVCenterDescriptionPattern,
          vmwareVCenter.description,
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
    rule: VMwareVCenterLabelRule,
  ): boolean {
    try {
      const regex: RegExp = new RegExp(pattern, "i");
      return regex.test(value);
    } catch {
      logger.warn(`Invalid regex in vCenter label rule ${rule.id}: ${pattern}`);
      return false;
    }
  }
}

export default new VMwareVCenterLabelRuleEngineServiceClass();

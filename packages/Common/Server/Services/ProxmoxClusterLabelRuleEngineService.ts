import Label from "../../Models/DatabaseModels/Label";
import ProxmoxCluster from "../../Models/DatabaseModels/ProxmoxCluster";
import ProxmoxClusterLabelRule from "../../Models/DatabaseModels/ProxmoxClusterLabelRule";
import ProxmoxClusterLabelRuleService from "./ProxmoxClusterLabelRuleService";
import ProxmoxClusterService from "./ProxmoxClusterService";
import ProxmoxClusterFeedService from "./ProxmoxClusterFeedService";
import { ProxmoxClusterFeedEventType } from "../../Models/DatabaseModels/ProxmoxClusterFeed";
import { Purple500 } from "../../Types/BrandColors";
import ObjectID from "../../Types/ObjectID";
import Select from "../Types/Database/Select";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import logger, { LogAttributes } from "../Utils/Logger";
import { MAX_RULES_EVALUATED_PER_PROJECT } from "../../Utils/Rules/RuleEngineLimits";
import { RuleCriteriaMatcher } from "../../Utils/Rules/RuleCriteriaMatcher";
import logIfRuleReadWasTruncated from "../Utils/Rules/RuleEngineRuleRead";
import {
  ApplyRulesToExistingResourceData,
  RuleApplicationResult,
  RuleApplicationResultUtil,
  RuleRunEngine,
} from "../Utils/Rules/RuleRun/RuleApplication";

class ProxmoxClusterLabelRuleEngineServiceClass
  implements RuleRunEngine<ProxmoxCluster, ProxmoxClusterLabelRule>
{
  public readonly ruleSelect: Select<ProxmoxClusterLabelRule> = {
    _id: true,
    name: true,
    criteria: true,
    proxmoxClusterLabels: { _id: true },
    proxmoxClusterNamePattern: true,
    proxmoxClusterDescriptionPattern: true,
    labelsToAdd: { _id: true },
  };

  // Evaluation re-reads the Proxmox cluster, so a run only has to name it.
  public readonly resourceSelectForRuleRun: Select<ProxmoxCluster> = {
    _id: true,
    projectId: true,
  };

  /**
   * Evaluates ProxmoxClusterLabelRule rows for the given Proxmox cluster and attaches matched
   * labels to it. The union is deduped against labels already on the Proxmox cluster
   * before insert to avoid PK conflicts on the join table.
   */
  @CaptureSpan()
  public async applyRulesToProxmoxCluster(
    proxmoxCluster: ProxmoxCluster,
  ): Promise<void> {
    if (!proxmoxCluster.id || !proxmoxCluster.projectId) {
      return;
    }

    try {
      const rules: Array<ProxmoxClusterLabelRule> =
        await ProxmoxClusterLabelRuleService.findBy({
          query: {
            projectId: proxmoxCluster.projectId,
            isEnabled: true,
          },
          props: { isRoot: true },
          select: this.ruleSelect,
          limit: MAX_RULES_EVALUATED_PER_PROJECT,
          skip: 0,
        });

      logIfRuleReadWasTruncated({
        ruleKind: "ProxmoxClusterLabelRule",
        projectId: proxmoxCluster.projectId,
        rulesRead: rules.length,
      });

      if (rules.length === 0) {
        return;
      }

      await this.applyRules({ proxmoxCluster: proxmoxCluster, rules: rules });
    } catch (error) {
      logger.error(`Error applying Proxmox cluster label rules: ${error}`, {
        projectId: proxmoxCluster.projectId?.toString(),
        proxmoxClusterId: proxmoxCluster.id?.toString(),
      } as LogAttributes);
    }
  }

  /*
   * "Run now": the same evaluation, for a Proxmox cluster that already exists
   * and only the rules being run.
   */
  @CaptureSpan()
  public async applyRulesToExistingResource(
    data: ApplyRulesToExistingResourceData<
      ProxmoxCluster,
      ProxmoxClusterLabelRule
    >,
  ): Promise<RuleApplicationResult> {
    try {
      return await this.applyRules({
        proxmoxCluster: data.resource,
        rules: data.rules,
      });
    } catch (error) {
      logger.error(`Error running Proxmox cluster label rules: ${error}`, {
        projectId: data.resource.projectId?.toString(),
        proxmoxClusterId: data.resource.id?.toString(),
      } as LogAttributes);

      return RuleApplicationResultUtil.failed();
    }
  }

  private async applyRules(data: {
    proxmoxCluster: ProxmoxCluster;
    rules: Array<ProxmoxClusterLabelRule>;
  }): Promise<RuleApplicationResult> {
    const { proxmoxCluster, rules } = data;

    if (!proxmoxCluster.id || !proxmoxCluster.projectId || rules.length === 0) {
      return RuleApplicationResultUtil.noMatch();
    }

    const proxmoxClusterWithDetails: ProxmoxCluster | null =
      await ProxmoxClusterService.findOneById({
        id: proxmoxCluster.id,
        select: {
          name: true,
          description: true,
          labels: { _id: true },
        },
        props: { isRoot: true },
      });

    if (!proxmoxClusterWithDetails) {
      return RuleApplicationResultUtil.noMatch();
    }

    const labelIdsToAdd: Set<string> = new Set();
    const matchedRuleNames: Array<string> = [];
    let anyRuleMatched: boolean = false;

    for (const rule of rules) {
      const matches: boolean = this.doesProxmoxClusterMatchRule(
        proxmoxClusterWithDetails,
        rule,
      );
      if (!matches) {
        continue;
      }
      anyRuleMatched = true;
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

    if (!anyRuleMatched) {
      return RuleApplicationResultUtil.noMatch();
    }

    if (labelIdsToAdd.size === 0) {
      return RuleApplicationResultUtil.alreadyApplied();
    }

    const existingLabelIds: Set<string> = new Set(
      (proxmoxClusterWithDetails.labels || [])
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

    await ProxmoxClusterService.getRepository()
      .createQueryBuilder()
      .relation(ProxmoxCluster, "labels")
      .of(proxmoxCluster.id.toString())
      .add(newLabelIds);

    /*
     * Sync in-memory proxmoxCluster.labels so a downstream owner-rule engine in
     * the same onCreateSuccess chain can match on rule-added labels.
     */
    const mergedLabelIds: Set<string> = new Set([
      ...existingLabelIds,
      ...newLabelIds,
    ]);
    proxmoxCluster.labels = Array.from(mergedLabelIds).map((id: string) => {
      const label: Label = new Label();
      label.id = new ObjectID(id);
      return label;
    });

    logger.debug(
      `ProxmoxClusterLabelRuleEngine attached ${newLabelIds.length} labels to Proxmox cluster ${proxmoxCluster.id}`,
      { projectId: proxmoxCluster.projectId.toString() } as LogAttributes,
    );
    /*
     * Labels arriving from a rule rather than from a person is exactly the
     * kind of thing the overview page cannot explain, so record which rules
     * did it.
     */
    await ProxmoxClusterFeedService.createProxmoxClusterFeedItem({
      proxmoxClusterId: proxmoxCluster.id,
      projectId: proxmoxCluster.projectId,
      proxmoxClusterFeedEventType:
        ProxmoxClusterFeedEventType.LabelRuleExecuted,
      displayColor: Purple500,
      feedInfoInMarkdown: `🏷️ ${newLabelIds.length} label(s) were attached to ${await ProxmoxClusterService.getProxmoxClusterMarkdownLink(
        proxmoxCluster.projectId,
        proxmoxCluster.id,
      )} by label ${matchedRuleNames.length === 1 ? "rule" : "rules"}.`,
      moreInformationInMarkdown: `**Label rules that matched**: ${matchedRuleNames
        .map((name: string) => {
          return `\`${name}\``;
        })
        .join(", ")}`,
    });

    return RuleApplicationResultUtil.updated(newLabelIds.length);
  }

  private doesProxmoxClusterMatchRule(
    proxmoxCluster: ProxmoxCluster,
    rule: ProxmoxClusterLabelRule,
  ): boolean {
    return RuleCriteriaMatcher.matchesWithLegacySync({
      rule: rule,
      legacyFields: [
        "proxmoxClusterLabels",
        "proxmoxClusterNamePattern",
        "proxmoxClusterDescriptionPattern",
      ],
      emptyResult: true,
      matchesLegacyRule: (
        proxmoxClusterRule: ProxmoxClusterLabelRule,
      ): boolean => {
        return this.doesProxmoxClusterMatchRuleLegacy(
          proxmoxCluster,
          proxmoxClusterRule,
        );
      },
    });
  }

  private doesProxmoxClusterMatchRuleLegacy(
    proxmoxCluster: ProxmoxCluster,
    rule: ProxmoxClusterLabelRule,
  ): boolean {
    if (rule.proxmoxClusterLabels && rule.proxmoxClusterLabels.length > 0) {
      if (!proxmoxCluster.labels || proxmoxCluster.labels.length === 0) {
        return false;
      }
      const ruleLabelIds: Array<string> = rule.proxmoxClusterLabels.map(
        (l: Label) => {
          return l.id?.toString() || "";
        },
      );
      const labelIds: Array<string> = proxmoxCluster.labels.map((l: Label) => {
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
      rule.proxmoxClusterNamePattern &&
      (!proxmoxCluster.name ||
        !this.testRegex(
          rule.proxmoxClusterNamePattern,
          proxmoxCluster.name,
          rule,
        ))
    ) {
      return false;
    }

    if (
      rule.proxmoxClusterDescriptionPattern &&
      (!proxmoxCluster.description ||
        !this.testRegex(
          rule.proxmoxClusterDescriptionPattern,
          proxmoxCluster.description,
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
    rule: ProxmoxClusterLabelRule,
  ): boolean {
    try {
      const regex: RegExp = new RegExp(pattern, "i");
      return regex.test(value);
    } catch {
      logger.warn(
        `Invalid regex in Proxmox cluster label rule ${rule.id}: ${pattern}`,
      );
      return false;
    }
  }
}

export default new ProxmoxClusterLabelRuleEngineServiceClass();

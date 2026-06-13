import Label from "../../Models/DatabaseModels/Label";
import ProxmoxCluster from "../../Models/DatabaseModels/ProxmoxCluster";
import ProxmoxClusterLabelRule from "../../Models/DatabaseModels/ProxmoxClusterLabelRule";
import ProxmoxClusterLabelRuleService from "./ProxmoxClusterLabelRuleService";
import ProxmoxClusterService from "./ProxmoxClusterService";
import ObjectID from "../../Types/ObjectID";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import logger, { LogAttributes } from "../Utils/Logger";

class ProxmoxClusterLabelRuleEngineServiceClass {
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
          select: {
            _id: true,
            name: true,
            proxmoxClusterLabels: { _id: true },
            proxmoxClusterNamePattern: true,
            proxmoxClusterDescriptionPattern: true,
            labelsToAdd: { _id: true },
          },
          limit: 100,
          skip: 0,
        });

      if (rules.length === 0) {
        return;
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
        return;
      }

      const labelIdsToAdd: Set<string> = new Set();

      for (const rule of rules) {
        const matches: boolean = this.doesProxmoxClusterMatchRule(
          proxmoxClusterWithDetails,
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
        return;
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
    } catch (error) {
      logger.error(`Error applying Proxmox cluster label rules: ${error}`, {
        projectId: proxmoxCluster.projectId?.toString(),
        proxmoxClusterId: proxmoxCluster.id?.toString(),
      } as LogAttributes);
    }
  }

  private doesProxmoxClusterMatchRule(
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

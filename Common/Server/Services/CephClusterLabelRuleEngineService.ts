import Label from "../../Models/DatabaseModels/Label";
import CephCluster from "../../Models/DatabaseModels/CephCluster";
import CephClusterLabelRule from "../../Models/DatabaseModels/CephClusterLabelRule";
import CephClusterLabelRuleService from "./CephClusterLabelRuleService";
import CephClusterService from "./CephClusterService";
import ObjectID from "../../Types/ObjectID";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import logger, { LogAttributes } from "../Utils/Logger";

class CephClusterLabelRuleEngineServiceClass {
  /**
   * Evaluates CephClusterLabelRule rows for the given Ceph cluster and attaches matched
   * labels to it. The union is deduped against labels already on the Ceph cluster
   * before insert to avoid PK conflicts on the join table.
   */
  @CaptureSpan()
  public async applyRulesToCephCluster(
    cephCluster: CephCluster,
  ): Promise<void> {
    if (!cephCluster.id || !cephCluster.projectId) {
      return;
    }

    try {
      const rules: Array<CephClusterLabelRule> =
        await CephClusterLabelRuleService.findBy({
          query: {
            projectId: cephCluster.projectId,
            isEnabled: true,
          },
          props: { isRoot: true },
          select: {
            _id: true,
            name: true,
            cephClusterLabels: { _id: true },
            cephClusterNamePattern: true,
            cephClusterDescriptionPattern: true,
            labelsToAdd: { _id: true },
          },
          limit: 100,
          skip: 0,
        });

      if (rules.length === 0) {
        return;
      }

      const cephClusterWithDetails: CephCluster | null =
        await CephClusterService.findOneById({
          id: cephCluster.id,
          select: {
            name: true,
            description: true,
            labels: { _id: true },
          },
          props: { isRoot: true },
        });

      if (!cephClusterWithDetails) {
        return;
      }

      const labelIdsToAdd: Set<string> = new Set();

      for (const rule of rules) {
        const matches: boolean = this.doesCephClusterMatchRule(
          cephClusterWithDetails,
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
        (cephClusterWithDetails.labels || [])
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

      await CephClusterService.getRepository()
        .createQueryBuilder()
        .relation(CephCluster, "labels")
        .of(cephCluster.id.toString())
        .add(newLabelIds);

      /*
       * Sync in-memory cephCluster.labels so a downstream owner-rule engine in
       * the same onCreateSuccess chain can match on rule-added labels.
       */
      const mergedLabelIds: Set<string> = new Set([
        ...existingLabelIds,
        ...newLabelIds,
      ]);
      cephCluster.labels = Array.from(mergedLabelIds).map((id: string) => {
        const label: Label = new Label();
        label.id = new ObjectID(id);
        return label;
      });

      logger.debug(
        `CephClusterLabelRuleEngine attached ${newLabelIds.length} labels to Ceph cluster ${cephCluster.id}`,
        { projectId: cephCluster.projectId.toString() } as LogAttributes,
      );
    } catch (error) {
      logger.error(`Error applying Ceph cluster label rules: ${error}`, {
        projectId: cephCluster.projectId?.toString(),
        cephClusterId: cephCluster.id?.toString(),
      } as LogAttributes);
    }
  }

  private doesCephClusterMatchRule(
    cephCluster: CephCluster,
    rule: CephClusterLabelRule,
  ): boolean {
    if (rule.cephClusterLabels && rule.cephClusterLabels.length > 0) {
      if (!cephCluster.labels || cephCluster.labels.length === 0) {
        return false;
      }
      const ruleLabelIds: Array<string> = rule.cephClusterLabels.map(
        (l: Label) => {
          return l.id?.toString() || "";
        },
      );
      const labelIds: Array<string> = cephCluster.labels.map((l: Label) => {
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
      rule.cephClusterNamePattern &&
      (!cephCluster.name ||
        !this.testRegex(rule.cephClusterNamePattern, cephCluster.name, rule))
    ) {
      return false;
    }

    if (
      rule.cephClusterDescriptionPattern &&
      (!cephCluster.description ||
        !this.testRegex(
          rule.cephClusterDescriptionPattern,
          cephCluster.description,
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
    rule: CephClusterLabelRule,
  ): boolean {
    try {
      const regex: RegExp = new RegExp(pattern, "i");
      return regex.test(value);
    } catch {
      logger.warn(
        `Invalid regex in Ceph cluster label rule ${rule.id}: ${pattern}`,
      );
      return false;
    }
  }
}

export default new CephClusterLabelRuleEngineServiceClass();

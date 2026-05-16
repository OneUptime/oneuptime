import Label from "../../Models/DatabaseModels/Label";
import KubernetesCluster from "../../Models/DatabaseModels/KubernetesCluster";
import KubernetesClusterLabelRule from "../../Models/DatabaseModels/KubernetesClusterLabelRule";
import KubernetesClusterLabelRuleService from "./KubernetesClusterLabelRuleService";
import KubernetesClusterService from "./KubernetesClusterService";
import ObjectID from "../../Types/ObjectID";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import logger, { LogAttributes } from "../Utils/Logger";

class KubernetesClusterLabelRuleEngineServiceClass {
  /**
   * Evaluates KubernetesClusterLabelRule rows for the given Kubernetes cluster and attaches matched
   * labels to it. The union is deduped against labels already on the Kubernetes cluster
   * before insert to avoid PK conflicts on the join table.
   */
  @CaptureSpan()
  public async applyRulesToKubernetesCluster(
    kubernetesCluster: KubernetesCluster,
  ): Promise<void> {
    if (!kubernetesCluster.id || !kubernetesCluster.projectId) {
      return;
    }

    try {
      const rules: Array<KubernetesClusterLabelRule> =
        await KubernetesClusterLabelRuleService.findBy({
          query: {
            projectId: kubernetesCluster.projectId,
            isEnabled: true,
          },
          props: { isRoot: true },
          select: {
            _id: true,
            name: true,
            kubernetesClusterLabels: { _id: true },
            kubernetesClusterNamePattern: true,
            kubernetesClusterDescriptionPattern: true,
            labelsToAdd: { _id: true },
          },
          limit: 100,
          skip: 0,
        });

      if (rules.length === 0) {
        return;
      }

      const kubernetesClusterWithDetails: KubernetesCluster | null =
        await KubernetesClusterService.findOneById({
          id: kubernetesCluster.id,
          select: {
            name: true,
            description: true,
            labels: { _id: true },
          },
          props: { isRoot: true },
        });

      if (!kubernetesClusterWithDetails) {
        return;
      }

      const labelIdsToAdd: Set<string> = new Set();

      for (const rule of rules) {
        const matches: boolean = this.doesKubernetesClusterMatchRule(
          kubernetesClusterWithDetails,
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
        (kubernetesClusterWithDetails.labels || [])
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

      await KubernetesClusterService.getRepository()
        .createQueryBuilder()
        .relation(KubernetesCluster, "labels")
        .of(kubernetesCluster.id.toString())
        .add(newLabelIds);

      /*
       * Sync in-memory kubernetesCluster.labels so a downstream owner-rule engine in
       * the same onCreateSuccess chain can match on rule-added labels.
       */
      const mergedLabelIds: Set<string> = new Set([
        ...existingLabelIds,
        ...newLabelIds,
      ]);
      kubernetesCluster.labels = Array.from(mergedLabelIds).map(
        (id: string) => {
          const label: Label = new Label();
          label.id = new ObjectID(id);
          return label;
        },
      );

      logger.debug(
        `KubernetesClusterLabelRuleEngine attached ${newLabelIds.length} labels to Kubernetes cluster ${kubernetesCluster.id}`,
        { projectId: kubernetesCluster.projectId.toString() } as LogAttributes,
      );
    } catch (error) {
      logger.error(`Error applying Kubernetes cluster label rules: ${error}`, {
        projectId: kubernetesCluster.projectId?.toString(),
        kubernetesClusterId: kubernetesCluster.id?.toString(),
      } as LogAttributes);
    }
  }

  private doesKubernetesClusterMatchRule(
    kubernetesCluster: KubernetesCluster,
    rule: KubernetesClusterLabelRule,
  ): boolean {
    if (
      rule.kubernetesClusterLabels &&
      rule.kubernetesClusterLabels.length > 0
    ) {
      if (!kubernetesCluster.labels || kubernetesCluster.labels.length === 0) {
        return false;
      }
      const ruleLabelIds: Array<string> = rule.kubernetesClusterLabels.map(
        (l: Label) => {
          return l.id?.toString() || "";
        },
      );
      const labelIds: Array<string> = kubernetesCluster.labels.map(
        (l: Label) => {
          return l.id?.toString() || "";
        },
      );
      if (
        !ruleLabelIds.some((id: string) => {
          return labelIds.includes(id);
        })
      ) {
        return false;
      }
    }

    if (
      rule.kubernetesClusterNamePattern &&
      (!kubernetesCluster.name ||
        !this.testRegex(
          rule.kubernetesClusterNamePattern,
          kubernetesCluster.name,
          rule,
        ))
    ) {
      return false;
    }

    if (
      rule.kubernetesClusterDescriptionPattern &&
      (!kubernetesCluster.description ||
        !this.testRegex(
          rule.kubernetesClusterDescriptionPattern,
          kubernetesCluster.description,
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
    rule: KubernetesClusterLabelRule,
  ): boolean {
    try {
      const regex: RegExp = new RegExp(pattern, "i");
      return regex.test(value);
    } catch {
      logger.warn(
        `Invalid regex in Kubernetes cluster label rule ${rule.id}: ${pattern}`,
      );
      return false;
    }
  }
}

export default new KubernetesClusterLabelRuleEngineServiceClass();

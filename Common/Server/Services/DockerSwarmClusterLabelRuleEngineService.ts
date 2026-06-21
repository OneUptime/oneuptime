import Label from "../../Models/DatabaseModels/Label";
import DockerSwarmCluster from "../../Models/DatabaseModels/DockerSwarmCluster";
import DockerSwarmClusterLabelRule from "../../Models/DatabaseModels/DockerSwarmClusterLabelRule";
import DockerSwarmClusterLabelRuleService from "./DockerSwarmClusterLabelRuleService";
import DockerSwarmClusterService from "./DockerSwarmClusterService";
import ObjectID from "../../Types/ObjectID";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import logger, { LogAttributes } from "../Utils/Logger";

class DockerSwarmClusterLabelRuleEngineServiceClass {
  /**
   * Evaluates DockerSwarmClusterLabelRule rows for the given DockerSwarm cluster and attaches matched
   * labels to it. The union is deduped against labels already on the DockerSwarm cluster
   * before insert to avoid PK conflicts on the join table.
   */
  @CaptureSpan()
  public async applyRulesToDockerSwarmCluster(
    dockerSwarmCluster: DockerSwarmCluster,
  ): Promise<void> {
    if (!dockerSwarmCluster.id || !dockerSwarmCluster.projectId) {
      return;
    }

    try {
      const rules: Array<DockerSwarmClusterLabelRule> =
        await DockerSwarmClusterLabelRuleService.findBy({
          query: {
            projectId: dockerSwarmCluster.projectId,
            isEnabled: true,
          },
          props: { isRoot: true },
          select: {
            _id: true,
            name: true,
            dockerSwarmClusterLabels: { _id: true },
            dockerSwarmClusterNamePattern: true,
            dockerSwarmClusterDescriptionPattern: true,
            labelsToAdd: { _id: true },
          },
          limit: 100,
          skip: 0,
        });

      if (rules.length === 0) {
        return;
      }

      const dockerSwarmClusterWithDetails: DockerSwarmCluster | null =
        await DockerSwarmClusterService.findOneById({
          id: dockerSwarmCluster.id,
          select: {
            name: true,
            description: true,
            labels: { _id: true },
          },
          props: { isRoot: true },
        });

      if (!dockerSwarmClusterWithDetails) {
        return;
      }

      const labelIdsToAdd: Set<string> = new Set();

      for (const rule of rules) {
        const matches: boolean = this.doesDockerSwarmClusterMatchRule(
          dockerSwarmClusterWithDetails,
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
        (dockerSwarmClusterWithDetails.labels || [])
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

      await DockerSwarmClusterService.getRepository()
        .createQueryBuilder()
        .relation(DockerSwarmCluster, "labels")
        .of(dockerSwarmCluster.id.toString())
        .add(newLabelIds);

      /*
       * Sync in-memory dockerSwarmCluster.labels so a downstream owner-rule engine in
       * the same onCreateSuccess chain can match on rule-added labels.
       */
      const mergedLabelIds: Set<string> = new Set([
        ...existingLabelIds,
        ...newLabelIds,
      ]);
      dockerSwarmCluster.labels = Array.from(mergedLabelIds).map(
        (id: string) => {
          const label: Label = new Label();
          label.id = new ObjectID(id);
          return label;
        },
      );

      logger.debug(
        `DockerSwarmClusterLabelRuleEngine attached ${newLabelIds.length} labels to DockerSwarm cluster ${dockerSwarmCluster.id}`,
        { projectId: dockerSwarmCluster.projectId.toString() } as LogAttributes,
      );
    } catch (error) {
      logger.error(`Error applying DockerSwarm cluster label rules: ${error}`, {
        projectId: dockerSwarmCluster.projectId?.toString(),
        dockerSwarmClusterId: dockerSwarmCluster.id?.toString(),
      } as LogAttributes);
    }
  }

  private doesDockerSwarmClusterMatchRule(
    dockerSwarmCluster: DockerSwarmCluster,
    rule: DockerSwarmClusterLabelRule,
  ): boolean {
    if (
      rule.dockerSwarmClusterLabels &&
      rule.dockerSwarmClusterLabels.length > 0
    ) {
      if (
        !dockerSwarmCluster.labels ||
        dockerSwarmCluster.labels.length === 0
      ) {
        return false;
      }
      const ruleLabelIds: Array<string> = rule.dockerSwarmClusterLabels.map(
        (l: Label) => {
          return l.id?.toString() || "";
        },
      );
      const labelIds: Array<string> = dockerSwarmCluster.labels.map(
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
      rule.dockerSwarmClusterNamePattern &&
      (!dockerSwarmCluster.name ||
        !this.testRegex(
          rule.dockerSwarmClusterNamePattern,
          dockerSwarmCluster.name,
          rule,
        ))
    ) {
      return false;
    }

    if (
      rule.dockerSwarmClusterDescriptionPattern &&
      (!dockerSwarmCluster.description ||
        !this.testRegex(
          rule.dockerSwarmClusterDescriptionPattern,
          dockerSwarmCluster.description,
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
    rule: DockerSwarmClusterLabelRule,
  ): boolean {
    try {
      const regex: RegExp = new RegExp(pattern, "i");
      return regex.test(value);
    } catch {
      logger.warn(
        `Invalid regex in DockerSwarm cluster label rule ${rule.id}: ${pattern}`,
      );
      return false;
    }
  }
}

export default new DockerSwarmClusterLabelRuleEngineServiceClass();

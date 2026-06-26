import Label from "../../Models/DatabaseModels/Label";
import DockerHost from "../../Models/DatabaseModels/DockerHost";
import DockerHostLabelRule from "../../Models/DatabaseModels/DockerHostLabelRule";
import DockerHostLabelRuleService from "./DockerHostLabelRuleService";
import DockerHostService from "./DockerHostService";
import ObjectID from "../../Types/ObjectID";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import logger, { LogAttributes } from "../Utils/Logger";

class DockerHostLabelRuleEngineServiceClass {
  /**
   * Evaluates DockerHostLabelRule rows for the given Docker host and attaches matched
   * labels to it. The union is deduped against labels already on the Docker host
   * before insert to avoid PK conflicts on the join table.
   */
  @CaptureSpan()
  public async applyRulesToDockerHost(dockerHost: DockerHost): Promise<void> {
    if (!dockerHost.id || !dockerHost.projectId) {
      return;
    }

    try {
      const rules: Array<DockerHostLabelRule> =
        await DockerHostLabelRuleService.findBy({
          query: {
            projectId: dockerHost.projectId,
            isEnabled: true,
          },
          props: { isRoot: true },
          select: {
            _id: true,
            name: true,
            dockerHostLabels: { _id: true },
            dockerHostNamePattern: true,
            dockerHostDescriptionPattern: true,
            labelsToAdd: { _id: true },
          },
          limit: 100,
          skip: 0,
        });

      if (rules.length === 0) {
        return;
      }

      const dockerHostWithDetails: DockerHost | null =
        await DockerHostService.findOneById({
          id: dockerHost.id,
          select: {
            name: true,
            description: true,
            labels: { _id: true },
          },
          props: { isRoot: true },
        });

      if (!dockerHostWithDetails) {
        return;
      }

      const labelIdsToAdd: Set<string> = new Set();

      for (const rule of rules) {
        const matches: boolean = this.doesDockerHostMatchRule(
          dockerHostWithDetails,
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
        (dockerHostWithDetails.labels || [])
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

      await DockerHostService.getRepository()
        .createQueryBuilder()
        .relation(DockerHost, "labels")
        .of(dockerHost.id.toString())
        .add(newLabelIds);

      /*
       * Sync in-memory dockerHost.labels so a downstream owner-rule engine in
       * the same onCreateSuccess chain can match on rule-added labels.
       */
      const mergedLabelIds: Set<string> = new Set([
        ...existingLabelIds,
        ...newLabelIds,
      ]);
      dockerHost.labels = Array.from(mergedLabelIds).map((id: string) => {
        const label: Label = new Label();
        label.id = new ObjectID(id);
        return label;
      });

      logger.debug(
        `DockerHostLabelRuleEngine attached ${newLabelIds.length} labels to Docker host ${dockerHost.id}`,
        { projectId: dockerHost.projectId.toString() } as LogAttributes,
      );
    } catch (error) {
      logger.error(`Error applying Docker host label rules: ${error}`, {
        projectId: dockerHost.projectId?.toString(),
        dockerHostId: dockerHost.id?.toString(),
      } as LogAttributes);
    }
  }

  private doesDockerHostMatchRule(
    dockerHost: DockerHost,
    rule: DockerHostLabelRule,
  ): boolean {
    if (rule.dockerHostLabels && rule.dockerHostLabels.length > 0) {
      if (!dockerHost.labels || dockerHost.labels.length === 0) {
        return false;
      }
      const ruleLabelIds: Array<string> = rule.dockerHostLabels.map(
        (l: Label) => {
          return l.id?.toString() || "";
        },
      );
      const labelIds: Array<string> = dockerHost.labels.map((l: Label) => {
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
      rule.dockerHostNamePattern &&
      (!dockerHost.name ||
        !this.testRegex(rule.dockerHostNamePattern, dockerHost.name, rule))
    ) {
      return false;
    }

    if (
      rule.dockerHostDescriptionPattern &&
      (!dockerHost.description ||
        !this.testRegex(
          rule.dockerHostDescriptionPattern,
          dockerHost.description,
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
    rule: DockerHostLabelRule,
  ): boolean {
    try {
      const regex: RegExp = new RegExp(pattern, "i");
      return regex.test(value);
    } catch {
      logger.warn(
        `Invalid regex in Docker host label rule ${rule.id}: ${pattern}`,
      );
      return false;
    }
  }
}

export default new DockerHostLabelRuleEngineServiceClass();

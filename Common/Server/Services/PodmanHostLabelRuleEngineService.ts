import Label from "../../Models/DatabaseModels/Label";
import PodmanHost from "../../Models/DatabaseModels/PodmanHost";
import PodmanHostLabelRule from "../../Models/DatabaseModels/PodmanHostLabelRule";
import PodmanHostLabelRuleService from "./PodmanHostLabelRuleService";
import PodmanHostService from "./PodmanHostService";
import ObjectID from "../../Types/ObjectID";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import logger, { LogAttributes } from "../Utils/Logger";

class PodmanHostLabelRuleEngineServiceClass {
  /**
   * Evaluates PodmanHostLabelRule rows for the given Podman host and attaches matched
   * labels to it. The union is deduped against labels already on the Podman host
   * before insert to avoid PK conflicts on the join table.
   */
  @CaptureSpan()
  public async applyRulesToPodmanHost(podmanHost: PodmanHost): Promise<void> {
    if (!podmanHost.id || !podmanHost.projectId) {
      return;
    }

    try {
      const rules: Array<PodmanHostLabelRule> =
        await PodmanHostLabelRuleService.findBy({
          query: {
            projectId: podmanHost.projectId,
            isEnabled: true,
          },
          props: { isRoot: true },
          select: {
            _id: true,
            name: true,
            podmanHostLabels: { _id: true },
            podmanHostNamePattern: true,
            podmanHostDescriptionPattern: true,
            labelsToAdd: { _id: true },
          },
          limit: 100,
          skip: 0,
        });

      if (rules.length === 0) {
        return;
      }

      const podmanHostWithDetails: PodmanHost | null =
        await PodmanHostService.findOneById({
          id: podmanHost.id,
          select: {
            name: true,
            description: true,
            labels: { _id: true },
          },
          props: { isRoot: true },
        });

      if (!podmanHostWithDetails) {
        return;
      }

      const labelIdsToAdd: Set<string> = new Set();

      for (const rule of rules) {
        const matches: boolean = this.doesPodmanHostMatchRule(
          podmanHostWithDetails,
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
        (podmanHostWithDetails.labels || [])
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

      await PodmanHostService.getRepository()
        .createQueryBuilder()
        .relation(PodmanHost, "labels")
        .of(podmanHost.id.toString())
        .add(newLabelIds);

      /*
       * Sync in-memory podmanHost.labels so a downstream owner-rule engine in
       * the same onCreateSuccess chain can match on rule-added labels.
       */
      const mergedLabelIds: Set<string> = new Set([
        ...existingLabelIds,
        ...newLabelIds,
      ]);
      podmanHost.labels = Array.from(mergedLabelIds).map((id: string) => {
        const label: Label = new Label();
        label.id = new ObjectID(id);
        return label;
      });

      logger.debug(
        `PodmanHostLabelRuleEngine attached ${newLabelIds.length} labels to Podman host ${podmanHost.id}`,
        { projectId: podmanHost.projectId.toString() } as LogAttributes,
      );
    } catch (error) {
      logger.error(`Error applying Podman host label rules: ${error}`, {
        projectId: podmanHost.projectId?.toString(),
        podmanHostId: podmanHost.id?.toString(),
      } as LogAttributes);
    }
  }

  private doesPodmanHostMatchRule(
    podmanHost: PodmanHost,
    rule: PodmanHostLabelRule,
  ): boolean {
    if (rule.podmanHostLabels && rule.podmanHostLabels.length > 0) {
      if (!podmanHost.labels || podmanHost.labels.length === 0) {
        return false;
      }
      const ruleLabelIds: Array<string> = rule.podmanHostLabels.map(
        (l: Label) => {
          return l.id?.toString() || "";
        },
      );
      const labelIds: Array<string> = podmanHost.labels.map((l: Label) => {
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
      rule.podmanHostNamePattern &&
      (!podmanHost.name ||
        !this.testRegex(rule.podmanHostNamePattern, podmanHost.name, rule))
    ) {
      return false;
    }

    if (
      rule.podmanHostDescriptionPattern &&
      (!podmanHost.description ||
        !this.testRegex(
          rule.podmanHostDescriptionPattern,
          podmanHost.description,
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
    rule: PodmanHostLabelRule,
  ): boolean {
    try {
      const regex: RegExp = new RegExp(pattern, "i");
      return regex.test(value);
    } catch {
      logger.warn(
        `Invalid regex in Podman host label rule ${rule.id}: ${pattern}`,
      );
      return false;
    }
  }
}

export default new PodmanHostLabelRuleEngineServiceClass();

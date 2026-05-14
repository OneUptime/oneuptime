import Label from "../../Models/DatabaseModels/Label";
import Host from "../../Models/DatabaseModels/Host";
import HostLabelRule from "../../Models/DatabaseModels/HostLabelRule";
import HostLabelRuleService from "./HostLabelRuleService";
import HostService from "./HostService";
import ObjectID from "../../Types/ObjectID";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import logger, { LogAttributes } from "../Utils/Logger";

class HostLabelRuleEngineServiceClass {
  /**
   * Evaluates HostLabelRule rows for the given host and attaches matched
   * labels to it. The union is deduped against labels already on the host
   * before insert to avoid PK conflicts on the join table.
   */
  @CaptureSpan()
  public async applyRulesToHost(host: Host): Promise<void> {
    if (!host.id || !host.projectId) {
      return;
    }

    try {
      const rules: Array<HostLabelRule> = await HostLabelRuleService.findBy({
        query: {
          projectId: host.projectId,
          isEnabled: true,
        },
        props: { isRoot: true },
        select: {
          _id: true,
          name: true,
          hostLabels: { _id: true },
          hostNamePattern: true,
          hostDescriptionPattern: true,
          labelsToAdd: { _id: true },
        },
        limit: 100,
        skip: 0,
      });

      if (rules.length === 0) {
        return;
      }

      const hostWithDetails: Host | null = await HostService.findOneById({
        id: host.id,
        select: {
          name: true,
          description: true,
          labels: { _id: true },
        },
        props: { isRoot: true },
      });

      if (!hostWithDetails) {
        return;
      }

      const labelIdsToAdd: Set<string> = new Set();

      for (const rule of rules) {
        const matches: boolean = this.doesHostMatchRule(hostWithDetails, rule);
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
        (hostWithDetails.labels || [])
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

      await HostService.getRepository()
        .createQueryBuilder()
        .relation(Host, "labels")
        .of(host.id.toString())
        .add(newLabelIds);

      /*
       * Sync in-memory host.labels so a downstream owner-rule engine in
       * the same onCreateSuccess chain can match on rule-added labels.
       */
      const mergedLabelIds: Set<string> = new Set([
        ...existingLabelIds,
        ...newLabelIds,
      ]);
      host.labels = Array.from(mergedLabelIds).map((id: string) => {
        const label: Label = new Label();
        label.id = new ObjectID(id);
        return label;
      });

      logger.debug(
        `HostLabelRuleEngine attached ${newLabelIds.length} labels to host ${host.id}`,
        { projectId: host.projectId.toString() } as LogAttributes,
      );
    } catch (error) {
      logger.error(`Error applying host label rules: ${error}`, {
        projectId: host.projectId?.toString(),
        hostId: host.id?.toString(),
      } as LogAttributes);
    }
  }

  private doesHostMatchRule(host: Host, rule: HostLabelRule): boolean {
    if (rule.hostLabels && rule.hostLabels.length > 0) {
      if (!host.labels || host.labels.length === 0) {
        return false;
      }
      const ruleLabelIds: Array<string> = rule.hostLabels.map((l: Label) => {
        return l.id?.toString() || "";
      });
      const labelIds: Array<string> = host.labels.map((l: Label) => {
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
      rule.hostNamePattern &&
      (!host.name || !this.testRegex(rule.hostNamePattern, host.name, rule))
    ) {
      return false;
    }

    if (
      rule.hostDescriptionPattern &&
      (!host.description ||
        !this.testRegex(rule.hostDescriptionPattern, host.description, rule))
    ) {
      return false;
    }

    return true;
  }

  private testRegex(
    pattern: string,
    value: string,
    rule: HostLabelRule,
  ): boolean {
    try {
      const regex: RegExp = new RegExp(pattern, "i");
      return regex.test(value);
    } catch {
      logger.warn(`Invalid regex in host label rule ${rule.id}: ${pattern}`);
      return false;
    }
  }
}

export default new HostLabelRuleEngineServiceClass();

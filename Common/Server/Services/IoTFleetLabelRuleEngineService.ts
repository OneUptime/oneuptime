import Label from "../../Models/DatabaseModels/Label";
import IoTFleet from "../../Models/DatabaseModels/IoTFleet";
import IoTFleetLabelRule from "../../Models/DatabaseModels/IoTFleetLabelRule";
import IoTFleetLabelRuleService from "./IoTFleetLabelRuleService";
import IoTFleetService from "./IoTFleetService";
import ObjectID from "../../Types/ObjectID";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import logger, { LogAttributes } from "../Utils/Logger";

class IoTFleetLabelRuleEngineServiceClass {
  /**
   * Evaluates IoTFleetLabelRule rows for the given IoT fleet and attaches matched
   * labels to it. The union is deduped against labels already on the IoT fleet
   * before insert to avoid PK conflicts on the join table.
   */
  @CaptureSpan()
  public async applyRulesToIoTFleet(iotFleet: IoTFleet): Promise<void> {
    if (!iotFleet.id || !iotFleet.projectId) {
      return;
    }

    try {
      const rules: Array<IoTFleetLabelRule> =
        await IoTFleetLabelRuleService.findBy({
          query: {
            projectId: iotFleet.projectId,
            isEnabled: true,
          },
          props: { isRoot: true },
          select: {
            _id: true,
            name: true,
            iotFleetLabels: { _id: true },
            iotFleetNamePattern: true,
            iotFleetDescriptionPattern: true,
            labelsToAdd: { _id: true },
          },
          limit: 100,
          skip: 0,
        });

      if (rules.length === 0) {
        return;
      }

      const iotFleetWithDetails: IoTFleet | null =
        await IoTFleetService.findOneById({
          id: iotFleet.id,
          select: {
            name: true,
            description: true,
            labels: { _id: true },
          },
          props: { isRoot: true },
        });

      if (!iotFleetWithDetails) {
        return;
      }

      const labelIdsToAdd: Set<string> = new Set();

      for (const rule of rules) {
        const matches: boolean = this.doesIoTFleetMatchRule(
          iotFleetWithDetails,
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
        (iotFleetWithDetails.labels || [])
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

      await IoTFleetService.getRepository()
        .createQueryBuilder()
        .relation(IoTFleet, "labels")
        .of(iotFleet.id.toString())
        .add(newLabelIds);

      /*
       * Sync in-memory iotFleet.labels so a downstream owner-rule engine in
       * the same onCreateSuccess chain can match on rule-added labels.
       */
      const mergedLabelIds: Set<string> = new Set([
        ...existingLabelIds,
        ...newLabelIds,
      ]);
      iotFleet.labels = Array.from(mergedLabelIds).map((id: string) => {
        const label: Label = new Label();
        label.id = new ObjectID(id);
        return label;
      });

      logger.debug(
        `IoTFleetLabelRuleEngine attached ${newLabelIds.length} labels to IoT fleet ${iotFleet.id}`,
        { projectId: iotFleet.projectId.toString() } as LogAttributes,
      );
    } catch (error) {
      logger.error(`Error applying IoT fleet label rules: ${error}`, {
        projectId: iotFleet.projectId?.toString(),
        iotFleetId: iotFleet.id?.toString(),
      } as LogAttributes);
    }
  }

  private doesIoTFleetMatchRule(
    iotFleet: IoTFleet,
    rule: IoTFleetLabelRule,
  ): boolean {
    if (rule.iotFleetLabels && rule.iotFleetLabels.length > 0) {
      if (!iotFleet.labels || iotFleet.labels.length === 0) {
        return false;
      }
      const ruleLabelIds: Array<string> = rule.iotFleetLabels.map(
        (l: Label) => {
          return l.id?.toString() || "";
        },
      );
      const labelIds: Array<string> = iotFleet.labels.map((l: Label) => {
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
      rule.iotFleetNamePattern &&
      (!iotFleet.name ||
        !this.testRegex(rule.iotFleetNamePattern, iotFleet.name, rule))
    ) {
      return false;
    }

    if (
      rule.iotFleetDescriptionPattern &&
      (!iotFleet.description ||
        !this.testRegex(
          rule.iotFleetDescriptionPattern,
          iotFleet.description,
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
    rule: IoTFleetLabelRule,
  ): boolean {
    try {
      const regex: RegExp = new RegExp(pattern, "i");
      return regex.test(value);
    } catch {
      logger.warn(
        `Invalid regex in IoT fleet label rule ${rule.id}: ${pattern}`,
      );
      return false;
    }
  }
}

export default new IoTFleetLabelRuleEngineServiceClass();

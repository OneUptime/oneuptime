import Label from "../../Models/DatabaseModels/Label";
import NetworkDevice from "../../Models/DatabaseModels/NetworkDevice";
import NetworkDeviceLabelRule from "../../Models/DatabaseModels/NetworkDeviceLabelRule";
import NetworkDeviceLabelRuleService from "./NetworkDeviceLabelRuleService";
import NetworkDeviceService from "./NetworkDeviceService";
import ObjectID from "../../Types/ObjectID";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import logger, { LogAttributes } from "../Utils/Logger";

class NetworkDeviceLabelRuleEngineServiceClass {
  /**
   * Evaluates NetworkDeviceLabelRule rows for the given network device and attaches matched
   * labels to it. The union is deduped against labels already on the network device
   * before insert to avoid PK conflicts on the join table.
   */
  @CaptureSpan()
  public async applyRulesToNetworkDevice(
    networkDevice: NetworkDevice,
  ): Promise<void> {
    if (!networkDevice.id || !networkDevice.projectId) {
      return;
    }

    try {
      const rules: Array<NetworkDeviceLabelRule> =
        await NetworkDeviceLabelRuleService.findBy({
          query: {
            projectId: networkDevice.projectId,
            isEnabled: true,
          },
          props: { isRoot: true },
          select: {
            _id: true,
            name: true,
            networkDeviceLabels: { _id: true },
            networkDeviceNamePattern: true,
            networkDeviceDescriptionPattern: true,
            labelsToAdd: { _id: true },
          },
          limit: 100,
          skip: 0,
        });

      if (rules.length === 0) {
        return;
      }

      const networkDeviceWithDetails: NetworkDevice | null =
        await NetworkDeviceService.findOneById({
          id: networkDevice.id,
          select: {
            name: true,
            description: true,
            labels: { _id: true },
          },
          props: { isRoot: true },
        });

      if (!networkDeviceWithDetails) {
        return;
      }

      const labelIdsToAdd: Set<string> = new Set();

      for (const rule of rules) {
        const matches: boolean = this.doesNetworkDeviceMatchRule(
          networkDeviceWithDetails,
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
        (networkDeviceWithDetails.labels || [])
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

      await NetworkDeviceService.getRepository()
        .createQueryBuilder()
        .relation(NetworkDevice, "labels")
        .of(networkDevice.id.toString())
        .add(newLabelIds);

      /*
       * Sync in-memory networkDevice.labels so a downstream owner-rule engine in
       * the same onCreateSuccess chain can match on rule-added labels.
       */
      const mergedLabelIds: Set<string> = new Set([
        ...existingLabelIds,
        ...newLabelIds,
      ]);
      networkDevice.labels = Array.from(mergedLabelIds).map((id: string) => {
        const label: Label = new Label();
        label.id = new ObjectID(id);
        return label;
      });

      logger.debug(
        `NetworkDeviceLabelRuleEngine attached ${newLabelIds.length} labels to network device ${networkDevice.id}`,
        { projectId: networkDevice.projectId.toString() } as LogAttributes,
      );
    } catch (error) {
      logger.error(`Error applying network device label rules: ${error}`, {
        projectId: networkDevice.projectId?.toString(),
        networkDeviceId: networkDevice.id?.toString(),
      } as LogAttributes);
    }
  }

  private doesNetworkDeviceMatchRule(
    networkDevice: NetworkDevice,
    rule: NetworkDeviceLabelRule,
  ): boolean {
    if (rule.networkDeviceLabels && rule.networkDeviceLabels.length > 0) {
      if (!networkDevice.labels || networkDevice.labels.length === 0) {
        return false;
      }
      const ruleLabelIds: Array<string> = rule.networkDeviceLabels.map(
        (l: Label) => {
          return l.id?.toString() || "";
        },
      );
      const labelIds: Array<string> = networkDevice.labels.map((l: Label) => {
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
      rule.networkDeviceNamePattern &&
      (!networkDevice.name ||
        !this.testRegex(
          rule.networkDeviceNamePattern,
          networkDevice.name,
          rule,
        ))
    ) {
      return false;
    }

    if (
      rule.networkDeviceDescriptionPattern &&
      (!networkDevice.description ||
        !this.testRegex(
          rule.networkDeviceDescriptionPattern,
          networkDevice.description,
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
    rule: NetworkDeviceLabelRule,
  ): boolean {
    try {
      const regex: RegExp = new RegExp(pattern, "i");
      return regex.test(value);
    } catch {
      logger.warn(
        `Invalid regex in network device label rule ${rule.id}: ${pattern}`,
      );
      return false;
    }
  }
}

export default new NetworkDeviceLabelRuleEngineServiceClass();

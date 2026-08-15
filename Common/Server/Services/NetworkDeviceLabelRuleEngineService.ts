import Label from "../../Models/DatabaseModels/Label";
import NetworkDevice from "../../Models/DatabaseModels/NetworkDevice";
import NetworkDeviceLabelRule from "../../Models/DatabaseModels/NetworkDeviceLabelRule";
import NetworkDeviceLabelRuleService from "./NetworkDeviceLabelRuleService";
import NetworkDeviceService from "./NetworkDeviceService";
import BadDataException from "../../Types/Exception/BadDataException";
import ObjectID from "../../Types/ObjectID";
import SortOrder from "../../Types/BaseDatabase/SortOrder";
import { LabelRuleRunResult } from "../../Types/NetworkAutomation/RuleRunResult";
import RulePatternMatchUtil from "../../Utils/Rules/RulePatternMatchUtil";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import logger, { LogAttributes } from "../Utils/Logger";

/*
 * Bounds on one manual "Run now" of a label rule. The automatic path only
 * ever sees a single freshly created device; a retroactive run walks the
 * whole estate, so it reads devices in pages and stops at a cap, reporting
 * isTruncated instead of holding an HTTP request open over a full fleet.
 */
export const MAX_DEVICES_PER_LABEL_RULE_RUN: number = 10000;
const LABEL_RULE_RUN_PAGE_SIZE: number = 1000;

/*
 * How many (device, label) pairs one INSERT attaches. TypeORM expands
 * `.of(ids).add(labelId)` into a parameter per id, and Postgres refuses a
 * statement with more than 65535 of them.
 */
const LABEL_ATTACH_CHUNK_SIZE: number = 500;

function chunk<T>(items: Array<T>, size: number): Array<Array<T>> {
  const chunks: Array<Array<T>> = [];
  for (let index: number = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

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

  /*
   * Runs ONE label rule against the network devices that already exist.
   *
   * The automatic engine above only fires on device creation, so a rule
   * written after an estate was imported or discovered would never reach a
   * single one of those devices (OneUptime/oneuptime#3191). This is the
   * manual counterpart: same matcher, same "already-attached labels are not
   * duplicated" guarantee, applied across the project instead of to one row.
   *
   * Safe to run repeatedly — attaching labels is additive and idempotent, so
   * a second run reports devicesMatched with devicesLabeled at zero.
   */
  @CaptureSpan()
  public async applyRuleToExistingNetworkDevices(data: {
    ruleId: ObjectID;
    projectId: ObjectID;
  }): Promise<LabelRuleRunResult> {
    const rule: NetworkDeviceLabelRule | null =
      await NetworkDeviceLabelRuleService.findOneBy({
        query: {
          _id: data.ruleId,
          projectId: data.projectId,
        },
        select: {
          _id: true,
          name: true,
          isEnabled: true,
          networkDeviceLabels: { _id: true },
          networkDeviceNamePattern: true,
          networkDeviceDescriptionPattern: true,
          labelsToAdd: { _id: true },
        },
        props: { isRoot: true },
      });

    if (!rule) {
      throw new BadDataException("Label rule not found.");
    }

    /*
     * A disabled rule is one the user has switched off; running it by hand
     * would contradict the toggle they can see right next to the button.
     */
    if (!rule.isEnabled) {
      throw new BadDataException(
        "This label rule is disabled. Enable it before running it.",
      );
    }

    const labelIdsToAdd: Array<string> = (rule.labelsToAdd || [])
      .map((label: Label) => {
        return label.id?.toString() || "";
      })
      .filter((id: string) => {
        return id !== "";
      });

    if (labelIdsToAdd.length === 0) {
      throw new BadDataException(
        "This label rule has no labels to add, so running it would do nothing.",
      );
    }

    const result: LabelRuleRunResult = {
      devicesEvaluated: 0,
      devicesMatched: 0,
      devicesLabeled: 0,
      labelsAttached: 0,
      labelsFailed: 0,
      isTruncated: false,
    };

    // Counted across pages so a device is never counted twice.
    const labeledDeviceIds: Set<string> = new Set();

    let skip: number = 0;

    for (;;) {
      const devices: Array<NetworkDevice> = await NetworkDeviceService.findBy({
        query: {
          projectId: data.projectId,
        },
        select: {
          _id: true,
          name: true,
          description: true,
          labels: { _id: true },
        },
        /*
         * Sorted by id so paging stays stable across the writes this run
         * makes: attaching a label never changes a device's id, so no row
         * can shift between pages and be skipped or seen twice.
         */
        sort: {
          _id: SortOrder.Ascending,
        },
        limit: LABEL_RULE_RUN_PAGE_SIZE,
        skip: skip,
        props: { isRoot: true },
      });

      if (devices.length === 0) {
        break;
      }

      /*
       * One INSERT per label rather than per device: every matched device
       * needs the same label set, so the work collapses into a handful of
       * statements no matter how large the estate is.
       */
      const deviceIdsByLabelId: Map<string, Array<string>> = new Map();

      for (const device of devices) {
        result.devicesEvaluated++;

        if (!this.doesNetworkDeviceMatchRule(device, rule)) {
          continue;
        }

        result.devicesMatched++;

        const deviceId: string | undefined = device.id?.toString();

        if (!deviceId) {
          continue;
        }

        const existingLabelIds: Set<string> = new Set(
          (device.labels || []).map((label: Label) => {
            return label.id?.toString() || "";
          }),
        );

        for (const labelId of labelIdsToAdd) {
          if (existingLabelIds.has(labelId)) {
            continue;
          }

          const deviceIds: Array<string> =
            deviceIdsByLabelId.get(labelId) || [];
          deviceIds.push(deviceId);
          deviceIdsByLabelId.set(labelId, deviceIds);
        }
      }

      for (const [labelId, deviceIds] of deviceIdsByLabelId) {
        for (const deviceIdChunk of chunk(deviceIds, LABEL_ATTACH_CHUNK_SIZE)) {
          try {
            await NetworkDeviceService.getRepository()
              .createQueryBuilder()
              .relation(NetworkDevice, "labels")
              .of(deviceIdChunk)
              .add(labelId);

            result.labelsAttached += deviceIdChunk.length;

            for (const deviceId of deviceIdChunk) {
              labeledDeviceIds.add(deviceId);
            }
          } catch (error) {
            /*
             * A failed batch must not abandon the rest of the estate — the
             * run reports it and carries on.
             */
            result.labelsFailed += deviceIdChunk.length;
            logger.error(
              `Error attaching label ${labelId} from network device label rule ${data.ruleId.toString()}: ${error}`,
              {
                projectId: data.projectId.toString(),
              } as LogAttributes,
            );
          }
        }
      }

      skip += devices.length;

      if (devices.length < LABEL_RULE_RUN_PAGE_SIZE) {
        break;
      }

      if (skip >= MAX_DEVICES_PER_LABEL_RULE_RUN) {
        /*
         * A full last page is not proof that more devices exist — an estate
         * of exactly the cap would report a truncation that never happened.
         * One row settles it.
         */
        const nextDevice: Array<NetworkDevice> =
          await NetworkDeviceService.findBy({
            query: {
              projectId: data.projectId,
            },
            select: {
              _id: true,
            },
            sort: {
              _id: SortOrder.Ascending,
            },
            limit: 1,
            skip: skip,
            props: { isRoot: true },
          });

        result.isTruncated = nextDevice.length > 0;
        break;
      }
    }

    result.devicesLabeled = labeledDeviceIds.size;

    return result;
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
      !this.testPattern(rule.networkDeviceNamePattern, networkDevice.name, rule)
    ) {
      return false;
    }

    if (
      rule.networkDeviceDescriptionPattern &&
      !this.testPattern(
        rule.networkDeviceDescriptionPattern,
        networkDevice.description,
        rule,
      )
    ) {
      return false;
    }

    return true;
  }

  /*
   * Patterns are regexes, with a '*' wildcard fallback so the glob syntax the
   * neighbouring site assignment rules use does not silently match nothing.
   * See Common/Utils/Rules/RulePatternMatchUtil.
   */
  private testPattern(
    pattern: string,
    value: string | undefined,
    rule: NetworkDeviceLabelRule,
  ): boolean {
    if (!RulePatternMatchUtil.isSupportedPattern(pattern)) {
      logger.warn(
        `Invalid pattern in network device label rule ${rule.id}: ${pattern}. It is neither a valid regular expression nor a wildcard pattern, so it will never match.`,
      );
      return false;
    }

    return RulePatternMatchUtil.matches(value, pattern);
  }
}

export default new NetworkDeviceLabelRuleEngineServiceClass();

import DatabaseService from "./DatabaseService";
import Model from "../../Models/DatabaseModels/VMwareHealthSetting";
import BadDataException from "../../Types/Exception/BadDataException";
import {
  VMWARE_HEALTH_MAX_EVALUATION_MINUTES,
  VMWARE_HEALTH_PERCENT_RULE_KEYS,
  VMWARE_HEALTH_RULE_KEYS,
  VMwareHealthRuleKey,
  isVMwareHealthPeriodRuleKey,
} from "../../Types/VMware/VMwareHealthRules";
import CreateBy from "../Types/Database/CreateBy";
import { OnCreate, OnUpdate } from "../Types/Database/Hooks";
import UpdateBy from "../Types/Database/UpdateBy";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";

/*
 * A project's VMware health rules (VMwareHealthSetting, #11157): one row per
 * project, which VMware > Settings > Health Rules makes with every default
 * the first time it is opened, and the unique index keeps to one. It guards
 * what is written: each threshold is a whole number - a percent from 0 to
 * 100, a rate or an amount from 0 - or nothing, which turns its rule off.
 */

export const VMWARE_HEALTH_PERCENT_ERROR: string =
  "A percent threshold is a whole number from 0 to 100, or empty to turn its rule off.";
export const VMWARE_HEALTH_AMOUNT_ERROR: string =
  "A threshold is a whole number from 0, or empty to turn its rule off.";
export const VMWARE_HEALTH_PERIOD_ERROR: string = `A wait is a whole number of minutes from 0 to ${VMWARE_HEALTH_MAX_EVALUATION_MINUTES}. 0 judges the latest report.`;

export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
  }

  /*
   * Throws, in words the person can act on, for any value no threshold can
   * be. Nothing sent (undefined) and nothing set (null or "") pass: the one
   * keeps the column as it is, the other turns the rule off.
   */
  public static checkValues(data: Partial<Record<string, unknown>>): void {
    for (const key of VMWARE_HEALTH_RULE_KEYS) {
      const value: unknown = data[key];
      if (value === undefined || value === null || value === "") {
        continue;
      }

      const isPercent: boolean = VMWARE_HEALTH_PERCENT_RULE_KEYS.includes(
        key as VMwareHealthRuleKey,
      );
      const threshold: number =
        typeof value === "number" ? value : Number(value);

      // A period ("for at least N minutes", #11469): 0 to the longest wait.
      if (isVMwareHealthPeriodRuleKey(key as VMwareHealthRuleKey)) {
        if (
          !Number.isInteger(threshold) ||
          threshold < 0 ||
          threshold > VMWARE_HEALTH_MAX_EVALUATION_MINUTES
        ) {
          throw new BadDataException(VMWARE_HEALTH_PERIOD_ERROR);
        }
        continue;
      }

      if (
        !Number.isInteger(threshold) ||
        threshold < 0 ||
        (isPercent && threshold > 100)
      ) {
        throw new BadDataException(
          isPercent ? VMWARE_HEALTH_PERCENT_ERROR : VMWARE_HEALTH_AMOUNT_ERROR,
        );
      }
    }
  }

  /*
   * An empty field arrives as "": a threshold turned off. A wait is never
   * off: an empty one, or one set to nothing, is 0 - the latest report.
   */
  private static nullEmptyThresholds(
    data: Partial<Record<string, unknown>>,
  ): void {
    for (const key of VMWARE_HEALTH_RULE_KEYS) {
      if (isVMwareHealthPeriodRuleKey(key as VMwareHealthRuleKey)) {
        if (data[key] === "" || data[key] === null) {
          data[key] = 0;
        }
        continue;
      }
      if (data[key] === "") {
        data[key] = null;
      }
    }
  }

  @CaptureSpan()
  protected override async onBeforeCreate(
    createBy: CreateBy<Model>,
  ): Promise<OnCreate<Model>> {
    const data: Partial<Record<string, unknown>> =
      createBy.data as unknown as Partial<Record<string, unknown>>;
    Service.checkValues(data);
    Service.nullEmptyThresholds(data);

    return { createBy, carryForward: undefined };
  }

  @CaptureSpan()
  protected override async onBeforeUpdate(
    updateBy: UpdateBy<Model>,
  ): Promise<OnUpdate<Model>> {
    const data: Partial<Record<string, unknown>> =
      updateBy.data as unknown as Partial<Record<string, unknown>>;
    Service.checkValues(data);
    Service.nullEmptyThresholds(data);

    return { updateBy, carryForward: undefined };
  }
}

export default new Service();

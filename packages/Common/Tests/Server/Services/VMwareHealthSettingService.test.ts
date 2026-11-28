import VMwareHealthSetting from "../../../Models/DatabaseModels/VMwareHealthSetting";
import {
  Service as VMwareHealthSettingServiceClass,
  VMWARE_HEALTH_AMOUNT_ERROR,
  VMWARE_HEALTH_PERCENT_ERROR,
  VMWARE_HEALTH_PERIOD_ERROR,
} from "../../../Server/Services/VMwareHealthSettingService";
import { VMWARE_HEALTH_PERIOD_RULE_KEYS } from "../../../Types/VMware/VMwareHealthRules";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import { describe, expect, test } from "@jest/globals";

/*
 * What a project's VMware health rules may be set to (#11157): each
 * threshold a whole number - a percent from 0 to 100, a rate or an amount
 * from 0 - or nothing, which turns its rule off. The service refuses
 * anything else in words a person can act on, through the API as through
 * VMware > Settings > Health Rules, and an empty field arrives as nothing.
 */

function check(data: Record<string, unknown>): void {
  VMwareHealthSettingServiceClass.checkValues(data);
}

function expectRefused(data: Record<string, unknown>, message: string): void {
  let thrown: unknown = null;
  try {
    check(data);
  } catch (err) {
    thrown = err;
  }
  expect(thrown).toBeInstanceOf(BadDataException);
  expect((thrown as BadDataException).message).toBe(message);
}

describe("VMwareHealthSettingService.checkValues", () => {
  test("whole percents from 0 to 100 and whole amounts from 0 are taken", () => {
    expect(() => {
      check({
        hostCpuWarningPercent: 0,
        hostMemoryWarningPercent: 100,
        datastoreWarningPercent: 75,
        datastoreCriticalPercent: "88",
        vmSwapOutCriticalKibPerSecond: 0,
        vmSwapInWarningKibPerSecond: 1048576,
        vmSwappedWarningMebibytes: 2048,
        vmBalloonedWarningMebibytes: 512,
        vmCpuReadyWarningPercent: 12,
        resourcePoolSwapOutWarningKibPerSecond: 64,
      });
    }).not.toThrow();
  });

  test("nothing sent and nothing set pass: one keeps a column, the other turns its rule off", () => {
    expect(() => {
      check({
        hostCpuWarningPercent: undefined,
        datastoreCriticalPercent: null,
        vmSwappedWarningMebibytes: "",
      });
    }).not.toThrow();
  });

  test("a percent above 100, below 0 or not whole is refused", () => {
    for (const value of [101, -1, 92.5, "ninety"]) {
      expectRefused(
        { hostCpuWarningPercent: value },
        VMWARE_HEALTH_PERCENT_ERROR,
      );
    }
  });

  test("an amount or a rate below 0 or not whole is refused", () => {
    for (const value of [-1, 0.5, "lots"]) {
      expectRefused(
        { vmSwapOutCriticalKibPerSecond: value },
        VMWARE_HEALTH_AMOUNT_ERROR,
      );
    }
  });

  test("the words say what to do", () => {
    expect(VMWARE_HEALTH_PERCENT_ERROR).toBe(
      "A percent threshold is a whole number from 0 to 100, or empty to turn its rule off.",
    );
    expect(VMWARE_HEALTH_AMOUNT_ERROR).toBe(
      "A threshold is a whole number from 0, or empty to turn its rule off.",
    );
  });
});

describe("an empty field turns its rule off", () => {
  const service: VMwareHealthSettingServiceClass =
    new VMwareHealthSettingServiceClass();

  test("on create and on update, '' is written as nothing", async () => {
    const setting: VMwareHealthSetting = new VMwareHealthSetting();
    setting.projectId = ObjectID.generate();
    (setting as unknown as Record<string, unknown>)[
      "vmSwappedWarningMebibytes"
    ] = "";
    setting.hostCpuWarningPercent = 95;

    await (
      service as unknown as {
        onBeforeCreate: (
          createBy: CreateBy<VMwareHealthSetting>,
        ) => Promise<unknown>;
      }
    ).onBeforeCreate({
      data: setting,
      props: { isRoot: true },
    } as CreateBy<VMwareHealthSetting>);
    expect(setting.vmSwappedWarningMebibytes).toBeNull();
    expect(setting.hostCpuWarningPercent).toBe(95);

    const update: Record<string, unknown> = {
      datastoreCriticalPercent: "",
      datastoreWarningPercent: 70,
    };
    await (
      service as unknown as {
        onBeforeUpdate: (
          updateBy: UpdateBy<VMwareHealthSetting>,
        ) => Promise<unknown>;
      }
    ).onBeforeUpdate({
      query: { _id: ObjectID.generate().toString() },
      data: update,
      props: { isRoot: true },
    } as unknown as UpdateBy<VMwareHealthSetting>);
    expect(update).toEqual({
      datastoreCriticalPercent: null,
      datastoreWarningPercent: 70,
    });
  });

  test("a bad value is refused before anything is written", async () => {
    const setting: VMwareHealthSetting = new VMwareHealthSetting();
    setting.hostMemoryWarningPercent = 250;
    await expect(
      (
        service as unknown as {
          onBeforeCreate: (
            createBy: CreateBy<VMwareHealthSetting>,
          ) => Promise<unknown>;
        }
      ).onBeforeCreate({
        data: setting,
        props: { isRoot: true },
      } as CreateBy<VMwareHealthSetting>),
    ).rejects.toThrow(VMWARE_HEALTH_PERCENT_ERROR);
  });
});

describe("for at least N minutes (#11469)", () => {
  const service: VMwareHealthSettingServiceClass =
    new VMwareHealthSettingServiceClass();

  test("a whole number of minutes from 0 to 30 is taken, for every card", () => {
    for (const key of VMWARE_HEALTH_PERIOD_RULE_KEYS) {
      for (const value of [0, 1, 10, 30, "15"]) {
        expect(() => {
          check({ [key]: value });
        }).not.toThrow();
      }
    }
  });

  test("past 30, below 0 or not whole is refused, in words that say the range", () => {
    for (const key of VMWARE_HEALTH_PERIOD_RULE_KEYS) {
      for (const value of [31, 60, -1, 2.5, "soon"]) {
        expectRefused({ [key]: value }, VMWARE_HEALTH_PERIOD_ERROR);
      }
    }
    expect(VMWARE_HEALTH_PERIOD_ERROR).toBe(
      "A wait is a whole number of minutes from 0 to 30. 0 judges the latest report.",
    );
  });

  test("a wait emptied, or set to nothing, is written as 0: never off", async () => {
    const update: Record<string, unknown> = {
      hostEvaluationMinutes: "",
      datastoreEvaluationMinutes: null,
      vmSwapEvaluationMinutes: 10,
      hostCpuWarningPercent: "",
    };
    await (
      service as unknown as {
        onBeforeUpdate: (
          updateBy: UpdateBy<VMwareHealthSetting>,
        ) => Promise<unknown>;
      }
    ).onBeforeUpdate({
      query: { _id: ObjectID.generate().toString() },
      data: update,
      props: { isRoot: true },
    } as unknown as UpdateBy<VMwareHealthSetting>);
    expect(update).toEqual({
      hostEvaluationMinutes: 0,
      datastoreEvaluationMinutes: 0,
      vmSwapEvaluationMinutes: 10,
      // A threshold emptied is still a rule turned off.
      hostCpuWarningPercent: null,
    });
  });

  test("a wait not sent is left as it is", async () => {
    const update: Record<string, unknown> = { hostCpuWarningPercent: 80 };
    await (
      service as unknown as {
        onBeforeUpdate: (
          updateBy: UpdateBy<VMwareHealthSetting>,
        ) => Promise<unknown>;
      }
    ).onBeforeUpdate({
      query: { _id: ObjectID.generate().toString() },
      data: update,
      props: { isRoot: true },
    } as unknown as UpdateBy<VMwareHealthSetting>);
    expect(update).toEqual({ hostCpuWarningPercent: 80 });
  });

  test("a bad wait is refused before anything is written", async () => {
    const setting: VMwareHealthSetting = new VMwareHealthSetting();
    setting.vmMemoryCpuEvaluationMinutes = 45;
    await expect(
      (
        service as unknown as {
          onBeforeCreate: (
            createBy: CreateBy<VMwareHealthSetting>,
          ) => Promise<unknown>;
        }
      ).onBeforeCreate({
        data: setting,
        props: { isRoot: true },
      } as CreateBy<VMwareHealthSetting>),
    ).rejects.toThrow(VMWARE_HEALTH_PERIOD_ERROR);
  });
});

describe("who may read and change a project's health rules", () => {
  test("whoever may read a vCenter reads them; whoever may change one changes them", () => {
    const setting: VMwareHealthSetting = new VMwareHealthSetting();
    const access: {
      read?: Array<Permission>;
      update?: Array<Permission>;
      create?: Array<Permission>;
    } = {
      read: setting.readRecordPermissions,
      update: setting.updateRecordPermissions,
      create: setting.createRecordPermissions,
    };
    expect(access.read).toContain(Permission.ReadVMwareVCenter);
    expect(access.read).toContain(Permission.Viewer);
    expect(access.update).toContain(Permission.EditVMwareVCenter);
    expect(access.update).not.toContain(Permission.Viewer);
    expect(access.update).not.toContain(Permission.ReadVMwareVCenter);
    // The page makes the row the first time it is opened.
    expect(access.create).toContain(Permission.EditVMwareVCenter);
  });

  test("one row per project, served at /vmware-health-setting", () => {
    const setting: VMwareHealthSetting = new VMwareHealthSetting();
    expect(setting.getCrudApiPath()?.toString()).toBe("/vmware-health-setting");
    expect(setting.tableName).toBe("VMwareHealthSetting");
  });
});

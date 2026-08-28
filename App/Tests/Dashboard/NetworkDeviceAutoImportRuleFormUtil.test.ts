/*
 * PermissionGate normally reads the signed-in browser user before checking a
 * supplied permission snapshot. App tests run under Jest's Node environment,
 * so use the same user seam as the neighboring permission-gating suites.
 */
jest.mock("Common/UI/Utils/User", () => {
  return {
    __esModule: true,
    default: {
      isMasterAdmin: (): boolean => {
        return false;
      },
    },
  };
});

import NetworkDeviceAutoImportRule from "Common/Models/DatabaseModels/NetworkDeviceAutoImportRule";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import ObjectID from "Common/Types/ObjectID";
import Permission from "Common/Types/Permission";
import {
  canSelectAutoImportMonitorTemplate,
  getReadableMonitorTemplateColumn,
  updateMonitorIncompatibleBehavior,
} from "../../FeatureSet/Dashboard/src/Pages/NetworkDevice/Settings/AutoImportRuleFormUtil";
import { describe, expect, it } from "@jest/globals";

describe("Network Device auto-import rule monitor form state", () => {
  it("omits the Monitor Template column for a granular inventory-rule reader", () => {
    expect(
      getReadableMonitorTemplateColumn([
        Permission.ReadNetworkDeviceAutoImportRule,
      ]),
    ).toBeNull();
  });

  it("includes the Monitor Template column for a caller allowed to read it", () => {
    expect(
      getReadableMonitorTemplateColumn([Permission.ReadMonitorTemplate]),
    ).toEqual(
      expect.objectContaining({
        field: { monitorTemplate: { templateName: true } },
      }),
    );
  });

  it("shows the monitor step for an ordinary import rule", () => {
    expect(canSelectAutoImportMonitorTemplate({})).toBe(true);
  });

  it.each(["isExclusion", "includePingOnlyHosts"] as const)(
    "hides the monitor step when %s is enabled",
    (field: "isExclusion" | "includePingOnlyHosts") => {
      expect(canSelectAutoImportMonitorTemplate({ [field]: true })).toBe(false);
    },
  );

  it.each(["isExclusion", "includePingOnlyHosts"] as const)(
    "clears a persisted monitor template when %s is enabled",
    (field: "isExclusion" | "includePingOnlyHosts") => {
      const current: FormValues<NetworkDeviceAutoImportRule> = {
        monitorTemplate: "template-id",
        monitorTemplateId: ObjectID.generate(),
        name: "Rule",
      };

      const updated: FormValues<NetworkDeviceAutoImportRule> =
        updateMonitorIncompatibleBehavior(current, field, true);

      expect(updated).toEqual({
        monitorTemplate: null,
        monitorTemplateId: null,
        name: "Rule",
        [field]: true,
      });
      expect(current.monitorTemplate).toBe("template-id");
      expect(current.monitorTemplateId).toBeInstanceOf(ObjectID);
    },
  );

  it("preserves a selected template when an incompatible toggle is turned off", () => {
    expect(
      updateMonitorIncompatibleBehavior(
        { monitorTemplate: "template-id", isExclusion: true },
        "isExclusion",
        false,
      ),
    ).toEqual({ monitorTemplate: "template-id", isExclusion: false });
  });
});

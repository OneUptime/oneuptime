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

import fs from "fs";
import path from "path";
import MonitorTemplate from "Common/Models/DatabaseModels/MonitorTemplate";
import NetworkDeviceAutoImportRule from "Common/Models/DatabaseModels/NetworkDeviceAutoImportRule";
import Column from "Common/UI/Components/ModelTable/Column";
import { getColumnBaseId } from "Common/UI/Components/ModelTable/ColumnPreference";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import ObjectID from "Common/Types/ObjectID";
import Permission from "Common/Types/Permission";

import {
  canSelectAutoImportMonitorTemplate,
  getReadableMonitorTemplateColumn,
  updateMonitorIncompatibleBehavior,
} from "../../FeatureSet/Dashboard/src/Pages/NetworkDevice/Settings/AutoImportRuleFormUtil";
import { describe, expect, it } from "@jest/globals";

const FORM_UTIL_SOURCE: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
  "Pages",
  "NetworkDevice",
  "Settings",
  "AutoImportRuleFormUtil.ts",
);

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
        selectedProperty: "templateName",
      }),
    );
  });

  /*
   * Regression: the column used to declare only the relation, so the table
   * key was the relation itself and the cell rendered "[object Object]".
   * Resolve the key the way TableRow does to prove it lands on the name.
   */
  it("resolves the Monitor Template cell to the template name, not [object Object]", () => {
    const column: Column<NetworkDeviceAutoImportRule> | null =
      getReadableMonitorTemplateColumn([Permission.ReadMonitorTemplate]);

    expect(column).not.toBeNull();

    const declaredField: string = Object.keys(
      column!.field as Record<string, unknown>,
    )[0]!;
    const cellKey: string = column!.selectedProperty
      ? `${declaredField}.${column!.selectedProperty}`
      : declaredField;

    const rule: NetworkDeviceAutoImportRule = new NetworkDeviceAutoImportRule();
    const monitorTemplate: MonitorTemplate = new MonitorTemplate();
    monitorTemplate.templateName = "Unit Router Monitor";
    rule.monitorTemplate = monitorTemplate;

    // The same nested lookup TableRow performs on the fetched row.
    const rendered: unknown = cellKey
      .split(".")
      .reduce((current: any, key: string) => {
        return current?.[key];
      }, rule as any);

    expect(String(rendered)).toBe("Unit Router Monitor");
    expect(String(rendered)).not.toBe("[object Object]");
  });

  /*
   * The hand-rolled lookup above models TableRow; this runs the real
   * derivation shipped in ColumnPreference, so the column is proven to carry
   * a property the production code actually consumes rather than one only
   * this suite understands.
   */
  it("derives a column identity that reaches through to the template name", () => {
    expect(
      getColumnBaseId(
        getReadableMonitorTemplateColumn([Permission.ReadMonitorTemplate])!,
      ),
    ).toBe("monitorTemplate.templateName");
  });

  it("leaves the cell empty for an inventory-only rule with no template", () => {
    const column: Column<NetworkDeviceAutoImportRule> =
      getReadableMonitorTemplateColumn([Permission.ReadMonitorTemplate])!;

    const rendered: unknown = `monitorTemplate.${column.selectedProperty}`
      .split(".")
      .reduce((current: any, key: string) => {
        return current?.[key];
      }, new NetworkDeviceAutoImportRule() as any);

    // undefined, so TableRow falls through to noValueMessage rather than crashing.
    expect(rendered).toBeUndefined();
  });

  /*
   * The bug class, not just the instance: an Entity column that names neither
   * a property nor an element renders the relation object itself.
   */
  it("keeps every Entity column in this util renderable", () => {
    const source: string = fs.readFileSync(FORM_UTIL_SOURCE, "utf8");
    const entityColumnCount: number = (
      source.match(/type: FieldType\.Entity/g) || []
    ).length;

    expect(entityColumnCount).toBeGreaterThan(0);
    expect(
      (source.match(/selectedProperty|getElement/g) || []).length,
    ).toBeGreaterThanOrEqual(entityColumnCount);
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

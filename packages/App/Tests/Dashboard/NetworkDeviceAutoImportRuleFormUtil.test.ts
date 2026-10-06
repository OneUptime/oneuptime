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
import TableColumnsToCsv from "Common/UI/Utils/TableColumnsToCsv";
import FieldType from "Common/UI/Components/Types/FieldType";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import ObjectID from "Common/Types/ObjectID";
import Permission from "Common/Types/Permission";

import {
  canPickAutoImportMonitorTemplate,
  canPickAutoImportOidTemplate,
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

/*
 * A rule's template is read with the rule itself (the model's read list), so
 * the Monitor Template column is shown to every rule reader, a granular one
 * included; the template's name rides along on the relation. Reading
 * templates without reading rules shows no rule at all, so it does not open
 * the column either.
 */
describe("Network Device auto-import rule monitor form state", () => {
  it("includes the Monitor Template column for a granular rule reader", () => {
    expect(
      getReadableMonitorTemplateColumn([
        Permission.ReadNetworkDeviceAutoImportRule,
      ]),
    ).toEqual(
      expect.objectContaining({
        field: { monitorTemplate: { templateName: true } },
        selectedProperty: "templateName",
      }),
    );
  });

  it.each([
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.ProjectMember,
    Permission.Viewer,
  ])("includes the Monitor Template column for %s", (permission: Permission) => {
    expect(getReadableMonitorTemplateColumn([permission])).not.toBeNull();
  });

  it.each([
    Permission.ReadMonitorTemplate,
    Permission.MonitorViewer,
    Permission.ReadNetworkDeviceOidTemplate,
  ])(
    "omits the Monitor Template column for %s, which reads no rule",
    (permission: Permission) => {
      expect(getReadableMonitorTemplateColumn([permission])).toBeNull();
    },
  );

  /*
   * Regression: the column used to declare only the relation, so the table
   * key was the relation itself and the cell rendered "[object Object]".
   * Resolve the key the way TableRow does to prove it lands on the name.
   */
  it("resolves the Monitor Template cell to the template name, not [object Object]", () => {
    const column: Column<NetworkDeviceAutoImportRule> | null =
      getReadableMonitorTemplateColumn([
        Permission.ReadNetworkDeviceAutoImportRule,
      ]);

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
        getReadableMonitorTemplateColumn([
        Permission.ReadNetworkDeviceAutoImportRule,
      ])!,
      ),
    ).toBe("monitorTemplate.templateName");
  });

  /*
   * The column comment justifies selectedProperty over getElement entirely on
   * CSV grounds — the exporter never calls getElement and looks for display
   * keys the template does not carry. Run the real exporter statics so that
   * justification is pinned rather than asserted in prose.
   */
  it("exports the template name rather than a JSON blob", () => {
    const rule: NetworkDeviceAutoImportRule = new NetworkDeviceAutoImportRule();
    const monitorTemplate: MonitorTemplate = new MonitorTemplate();
    monitorTemplate.templateName = "Unit Router Monitor";
    rule.monitorTemplate = monitorTemplate;

    const cellKey: string = getColumnBaseId(
      getReadableMonitorTemplateColumn([
        Permission.ReadNetworkDeviceAutoImportRule,
      ])!,
    );

    expect(
      TableColumnsToCsv.formatValueForCsv(
        TableColumnsToCsv.getRawValueByPath(rule, cellKey),
        FieldType.Entity,
      ),
    ).toBe("Unit Router Monitor");

    // The pre-fix key handed the exporter the relation itself.
    expect(
      TableColumnsToCsv.formatValueForCsv(
        TableColumnsToCsv.getRawValueByPath(rule, "monitorTemplate"),
        FieldType.Entity,
      ),
    ).not.toBe("Unit Router Monitor");
  });

  it("leaves the cell empty for an inventory-only rule with no template", () => {
    const column: Column<NetworkDeviceAutoImportRule> =
      getReadableMonitorTemplateColumn([
        Permission.ReadNetworkDeviceAutoImportRule,
      ])!;

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

  /*
   * A picker lists the project's templates, so it is offered only to who may
   * read the rule's template column AND list the templates: a granular rule
   * reader without template access keeps an inventory-only form instead of a
   * picker whose list request would be refused.
   */
  it("offers the Monitor Template picker to who may read the rule and list monitor templates", () => {
    expect(
      canPickAutoImportMonitorTemplate([
        Permission.ReadNetworkDeviceAutoImportRule,
        Permission.ReadMonitorTemplate,
      ]),
    ).toBe(true);
    expect(
      canPickAutoImportMonitorTemplate([
        Permission.ReadNetworkDeviceAutoImportRule,
        Permission.MonitorViewer,
      ]),
    ).toBe(true);

    for (const role of [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
    ]) {
      expect([role, canPickAutoImportMonitorTemplate([role])]).toEqual([
        role,
        true,
      ]);
    }
  });

  it("does not offer the Monitor Template picker without both reads", () => {
    expect(
      canPickAutoImportMonitorTemplate([
        Permission.ReadNetworkDeviceAutoImportRule,
      ]),
    ).toBe(false);
    expect(
      canPickAutoImportMonitorTemplate([Permission.ReadMonitorTemplate]),
    ).toBe(false);
    expect(canPickAutoImportMonitorTemplate([])).toBe(false);
  });

  it("offers the OID Collection Template picker to who may read the rule and list OID templates", () => {
    expect(
      canPickAutoImportOidTemplate([
        Permission.ReadNetworkDeviceAutoImportRule,
        Permission.ReadNetworkDeviceOidTemplate,
      ]),
    ).toBe(true);
    expect(canPickAutoImportOidTemplate([Permission.ProjectMember])).toBe(
      true,
    );
    expect(
      canPickAutoImportOidTemplate([
        Permission.ReadNetworkDeviceAutoImportRule,
      ]),
    ).toBe(false);
    expect(
      canPickAutoImportOidTemplate([Permission.ReadNetworkDeviceOidTemplate]),
    ).toBe(false);
    // The monitor template permission lists no OID template.
    expect(
      canPickAutoImportOidTemplate([
        Permission.ReadNetworkDeviceAutoImportRule,
        Permission.ReadMonitorTemplate,
      ]),
    ).toBe(false);
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

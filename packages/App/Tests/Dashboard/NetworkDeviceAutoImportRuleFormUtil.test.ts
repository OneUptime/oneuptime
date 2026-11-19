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
import NetworkDeviceOidTemplate from "Common/Models/DatabaseModels/NetworkDeviceOidTemplate";
import PermissionGate from "Common/UI/Utils/PermissionGate";
import Column from "Common/UI/Components/ModelTable/Column";
import { getColumnBaseId } from "Common/UI/Components/ModelTable/ColumnPreference";
import TableColumnsToCsv from "Common/UI/Utils/TableColumnsToCsv";
import FieldType from "Common/UI/Components/Types/FieldType";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import ObjectID from "Common/Types/ObjectID";
import Permission from "Common/Types/Permission";

import {
  AUTO_IMPORT_MONITOR_TEMPLATE_SELECT,
  NO_DEVICE_MONITOR_TEMPLATE_YET,
  canSelectAutoImportMonitorTemplate,
  getAutoImportMonitorTemplateOptions,
  getReadableMonitorTemplateColumn,
  updateMonitorIncompatibleBehavior,
} from "../../FeatureSet/Dashboard/src/Pages/NetworkDevice/Settings/AutoImportRuleFormUtil";
import {
  ADDRESS_TEMPLATES_GROUP_TITLE,
  POLL_TEMPLATES_GROUP_TITLE,
  UNNAMED_TEMPLATE_NAME,
  WEB_TEMPLATES_GROUP_TITLE,
} from "../../FeatureSet/Dashboard/src/Components/NetworkDevice/DiscoveryImport/DiscoveryImportTemplateCopy";
import URL from "Common/Types/API/URL";
import MonitorStep from "Common/Types/Monitor/MonitorStep";
import MonitorSteps from "Common/Types/Monitor/MonitorSteps";
import MonitorType from "Common/Types/Monitor/MonitorType";
import Port from "Common/Types/Port";
import {
  DropdownOption,
  DropdownOptionGroup,
} from "Common/UI/Components/Dropdown/Dropdown";
import {
  Translator,
  getGlobalTranslator,
} from "Common/UI/Utils/TranslateTemplate";
import { DEVICE_MONITOR_TEMPLATE_TYPES } from "Common/Utils/Monitor/DeviceMonitorTemplateUtil";
import { describe, expect, it } from "@jest/globals";

const PAGE_SOURCE: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
  "Pages",
  "NetworkDevice",
  "Settings",
  "AutoImportRules.tsx",
);

// The page's two pickers, through the shared gate it uses for them.
function canPickMonitorTemplate(permissions: Array<Permission>): boolean {
  return PermissionGate.canPickRelation(
    new NetworkDeviceAutoImportRule(),
    "monitorTemplate",
    new MonitorTemplate(),
    { permissions },
  );
}

function canPickOidTemplate(permissions: Array<Permission>): boolean {
  return PermissionGate.canPickRelation(
    new NetworkDeviceAutoImportRule(),
    "oidTemplate",
    new NetworkDeviceOidTemplate(),
    { permissions },
  );
}

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
  ])(
    "includes the Monitor Template column for %s",
    (permission: Permission) => {
      expect(getReadableMonitorTemplateColumn([permission])).not.toBeNull();
    },
  );

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
      canPickMonitorTemplate([
        Permission.ReadNetworkDeviceAutoImportRule,
        Permission.ReadMonitorTemplate,
      ]),
    ).toBe(true);
    expect(
      canPickMonitorTemplate([
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
      expect([role, canPickMonitorTemplate([role])]).toEqual([role, true]);
    }
  });

  it("does not offer the Monitor Template picker without both reads", () => {
    expect(
      canPickMonitorTemplate([Permission.ReadNetworkDeviceAutoImportRule]),
    ).toBe(false);
    expect(canPickMonitorTemplate([Permission.ReadMonitorTemplate])).toBe(
      false,
    );
    expect(canPickMonitorTemplate([])).toBe(false);
  });

  it("offers the OID Collection Template picker to who may read the rule and list OID templates", () => {
    expect(
      canPickOidTemplate([
        Permission.ReadNetworkDeviceAutoImportRule,
        Permission.ReadNetworkDeviceOidTemplate,
      ]),
    ).toBe(true);
    expect(canPickOidTemplate([Permission.ProjectMember])).toBe(true);
    expect(
      canPickOidTemplate([Permission.ReadNetworkDeviceAutoImportRule]),
    ).toBe(false);
    expect(canPickOidTemplate([Permission.ReadNetworkDeviceOidTemplate])).toBe(
      false,
    );
    // The monitor template permission lists no OID template.
    expect(
      canPickOidTemplate([
        Permission.ReadNetworkDeviceAutoImportRule,
        Permission.ReadMonitorTemplate,
      ]),
    ).toBe(false);
  });

  /*
   * The page hangs both pickers - and the Monitor step - off that gate,
   * each with its own template model, so a granular rule reader keeps an
   * inventory-only form rather than pickers whose lists are refused.
   */
  it("the rules page gates each template picker on the shared gate", () => {
    const page: string = fs
      .readFileSync(PAGE_SOURCE, "utf8")
      .replace(/\s+/g, " ");

    expect(page).toContain(
      'const canPickMonitorTemplate: boolean = PermissionGate.canPickRelation( new NetworkDeviceAutoImportRule(), "monitorTemplate", new MonitorTemplate(), );',
    );
    expect(page).toContain(
      'const canPickOidTemplate: boolean = PermissionGate.canPickRelation( new NetworkDeviceAutoImportRule(), "oidTemplate", new NetworkDeviceOidTemplate(), );',
    );
    expect(page.match(/\.\.\.\(canPickMonitorTemplate/g) || []).toHaveLength(2);
    expect(page.match(/\.\.\.\(canPickOidTemplate/g) || []).toHaveLength(1);
  });

  it("shows the monitor step for an ordinary import rule", () => {
    expect(canSelectAutoImportMonitorTemplate({})).toBe(true);
  });

  it("hides the monitor step on an exclusion rule", () => {
    expect(canSelectAutoImportMonitorTemplate({ isExclusion: true })).toBe(
      false,
    );
  });

  /*
   * A ping-only host imports as a probe-polled device, which a template's
   * reachability check reads - the same monitors an import from Review
   * Results makes for such hosts. Including them keeps the template.
   */
  it("keeps the monitor step for a rule that includes ping-only hosts", () => {
    expect(
      canSelectAutoImportMonitorTemplate({ includePingOnlyHosts: true }),
    ).toBe(true);
    expect(
      canSelectAutoImportMonitorTemplate({
        includePingOnlyHosts: true,
        isExclusion: true,
      }),
    ).toBe(false);
  });

  it.each(["isExclusion"] as const)(
    "clears a persisted monitor template when %s is enabled",
    (field: "isExclusion") => {
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

/*
 * ISSUE #9510. The rule's Monitor Template listed Network Device templates
 * only: a customer's Ping template - labels, interval and criteria set up -
 * could not be picked, and the list said "No options available". It lists
 * every kind a device's monitor can be made from now, as Review Results
 * does, and nothing that cannot check a device.
 */
describe("the Monitor Template a rule gives its devices (issue #9510)", () => {
  const translator: Translator = getGlobalTranslator();

  function templateOf(data: {
    name: string;
    monitorType: MonitorType;
    ports?: Array<number | undefined>;
    // The URL a web template's steps check, as written (#9546).
    url?: string;
  }): MonitorTemplate {
    const statusId: ObjectID = ObjectID.generate();
    const steps: MonitorSteps = new MonitorSteps();
    steps.data = {
      monitorStepsInstanceArray: (data.ports || [undefined]).map(
        (port: number | undefined): MonitorStep => {
          const step: MonitorStep = new MonitorStep();
          step.data!.id = ObjectID.generate().toString();

          if (port) {
            step.setPort(new Port(port));
          }

          if (data.url) {
            step.setMonitorDestination(URL.fromStringLenient(data.url));
          }

          return step;
        },
      ),
      defaultMonitorStatusId: statusId,
    };

    const template: MonitorTemplate = new MonitorTemplate();
    template.id = ObjectID.generate();
    template.templateName = data.name;
    template.monitorType = data.monitorType;
    template.monitorSteps = steps;
    return template;
  }

  function flatten(
    options: Array<DropdownOption | DropdownOptionGroup>,
  ): Array<DropdownOption> {
    return options.flatMap(
      (option: DropdownOption | DropdownOptionGroup): Array<DropdownOption> => {
        return "options" in option ? option.options : [option];
      },
    );
  }

  it("lists a Ping template on its own - the customer's case - with what it checks", () => {
    const options: Array<DropdownOption | DropdownOptionGroup> =
      getAutoImportMonitorTemplateOptions({
        templates: [
          templateOf({
            name: "WB KDS Ping Monitor Template",
            monitorType: MonitorType.Ping,
          }),
        ],
        translator: translator,
      });

    // One kind alone needs no heading.
    expect(options).toHaveLength(1);
    expect(options[0]).toMatchObject({
      label: "WB KDS Ping Monitor Template",
      isUserContent: true,
      description: "Pings each device",
      isDescriptionUserContent: true,
    });
  });

  it("lists every kind a device's monitor can be made from, Network Device first, under a heading each", () => {
    const options: Array<DropdownOption | DropdownOptionGroup> =
      getAutoImportMonitorTemplateOptions({
        templates: [
          templateOf({ name: "Kiosk Ping", monitorType: MonitorType.Ping }),
          templateOf({
            name: "Alert pack",
            monitorType: MonitorType.NetworkDevice,
          }),
          templateOf({ name: "Kiosk IP", monitorType: MonitorType.IP }),
          templateOf({
            name: "SSH",
            monitorType: MonitorType.Port,
            ports: [22],
          }),
          templateOf({
            name: "Web",
            monitorType: MonitorType.Port,
            ports: [80, 443],
          }),
          templateOf({ name: "Clock", monitorType: MonitorType.NTP }),
        ],
        translator: translator,
      });

    expect(
      options.map((option: DropdownOption | DropdownOptionGroup): string => {
        return String(option.label);
      }),
    ).toEqual([POLL_TEMPLATES_GROUP_TITLE, ADDRESS_TEMPLATES_GROUP_TITLE]);

    const [poll, address] = options as Array<DropdownOptionGroup>;

    expect(
      poll!.options.map((option: DropdownOption): string => {
        return String(option.label);
      }),
    ).toEqual(["Alert pack"]);
    // A Network Device template's monitor reads polls: no address line.
    expect(poll!.options[0]!.description).toBeUndefined();

    expect(
      address!.options.map(
        (option: DropdownOption): [string, string | undefined] => {
          return [String(option.label), option.description];
        },
      ),
    ).toEqual([
      ["Kiosk Ping", "Pings each device"],
      ["Kiosk IP", "Pings each device's IP address"],
      ["SSH", "Checks port 22 on each device"],
      ["Web", "Checks ports 80, 443 on each device"],
      ["Clock", "Asks each device for the time"],
    ]);
  });

  it("lists Website, API and SSL Certificate templates last, under Web templates, with the URL each device's monitor checks (#9546)", () => {
    const options: Array<DropdownOption | DropdownOptionGroup> =
      getAutoImportMonitorTemplateOptions({
        templates: [
          templateOf({
            name: "Status page",
            monitorType: MonitorType.Website,
            url: "https://device:8443/status",
          }),
          templateOf({ name: "Kiosk Ping", monitorType: MonitorType.Ping }),
          templateOf({
            name: "Health API",
            monitorType: MonitorType.API,
            url: "http://device/api/health",
          }),
          templateOf({
            name: "Cert",
            monitorType: MonitorType.SSLCertificate,
            url: "https://device/",
          }),
          // A web template with no URL yet still says what it checks.
          templateOf({ name: "Bare page", monitorType: MonitorType.Website }),
        ],
        translator: translator,
      });

    expect(
      options.map((option: DropdownOption | DropdownOptionGroup): string => {
        return String(option.label);
      }),
    ).toEqual([ADDRESS_TEMPLATES_GROUP_TITLE, WEB_TEMPLATES_GROUP_TITLE]);

    const web: DropdownOptionGroup = options[1] as DropdownOptionGroup;

    expect(
      web.options.map(
        (option: DropdownOption): [string, string | undefined] => {
          return [String(option.label), option.description];
        },
      ),
    ).toEqual([
      [
        "Status page",
        "Checks https://device:8443/status, with each device's address as the host",
      ],
      [
        "Health API",
        "Calls http://device/api/health, with each device's address as the host",
      ],
      [
        "Cert",
        "Checks the certificate at https://device/, with each device's address as the host. It must name that address.",
      ],
      ["Bare page", "Checks a page on each device"],
    ]);
    // The URL is the template's own words, drawn as written.
    expect(web.options[0]!.isDescriptionUserContent).toBe(true);
  });

  it("offers no template of a kind that cannot check a device", () => {
    const options: Array<DropdownOption> = flatten(
      getAutoImportMonitorTemplateOptions({
        templates: [
          templateOf({ name: "Manual", monitorType: MonitorType.Manual }),
          templateOf({
            name: "Heartbeat",
            monitorType: MonitorType.IncomingRequest,
          }),
          templateOf({ name: "DNS", monitorType: MonitorType.DNS }),
          templateOf({ name: "Logs", monitorType: MonitorType.Logs }),
          templateOf({ name: "Kiosk Ping", monitorType: MonitorType.Ping }),
        ],
        translator: translator,
      }),
    );

    expect(
      options.map((option: DropdownOption): string => {
        return String(option.label);
      }),
    ).toEqual(["Kiosk Ping"]);
  });

  it("names a template with no name in the reader's words, and lists none for a project without templates", () => {
    const unnamed: MonitorTemplate = templateOf({
      name: "",
      monitorType: MonitorType.NetworkDevice,
    });

    expect(
      getAutoImportMonitorTemplateOptions({
        templates: [unnamed],
        translator: translator,
      })[0],
    ).toMatchObject({
      value: unnamed.id!.toString(),
      label: UNNAMED_TEMPLATE_NAME,
      isUserContent: false,
    });

    expect(
      getAutoImportMonitorTemplateOptions({
        templates: [],
        translator: translator,
      }),
    ).toEqual([]);
  });

  it("the empty list says which templates work and how to make one", () => {
    expect(NO_DEVICE_MONITOR_TEMPLATE_YET).toContain(
      "Network Device, Ping, IP, Port, NTP, Website, API or SSL Certificate",
    );
    expect(NO_DEVICE_MONITOR_TEMPLATE_YET).toContain("Manage templates");
    expect(NO_DEVICE_MONITOR_TEMPLATE_YET).toMatch(/^[A-Z].*\.$/);
  });

  it("the page asks for every kind, names the field Monitor Template, says which templates work and links to them", () => {
    const page: string = fs
      .readFileSync(PAGE_SOURCE, "utf8")
      .replace(/\s+/g, " ");

    expect(page).toContain(
      "monitorType: new Includes([...DEVICE_MONITOR_TEMPLATE_TYPES])",
    );
    expect(page).toContain("select: AUTO_IMPORT_MONITOR_TEMPLATE_SELECT");
    expect(page).toContain('title: "Monitor Template", stepId: "monitor"');
    expect(page).not.toContain("Network Device Monitor Template");
    expect(page).not.toContain("monitorType: MonitorType.NetworkDevice");
    expect(page).toContain("description: LISTED_TEMPLATE_KINDS_RULE");
    expect(page).toContain("noOptionsText: NO_DEVICE_MONITOR_TEMPLATE_YET");
    expect(page).toContain(
      'sideLink: { text: "Manage templates", url: RouteUtil.populateRouteParams( RouteMap[PageMap.MONITORS_SETTINGS_TEMPLATES] as Route, ), openLinkInNewTab: true, }',
    );
    expect(page).toContain("fetchDropdownOptions: fetchDeviceMonitorTemplates");
  });

  it("reads what names a template and what it checks, and nothing else", () => {
    expect(AUTO_IMPORT_MONITOR_TEMPLATE_SELECT).toEqual({
      _id: true,
      templateName: true,
      monitorType: true,
      monitorSteps: true,
    });
    expect([...DEVICE_MONITOR_TEMPLATE_TYPES]).toEqual([
      MonitorType.NetworkDevice,
      MonitorType.Ping,
      MonitorType.IP,
      MonitorType.Port,
      MonitorType.NTP,
      MonitorType.Website,
      MonitorType.API,
      MonitorType.SSLCertificate,
    ]);
  });
});

import {
  DEVICE_SNMP_FACET_OPTIONS,
  DEVICE_STATUS_FACET_OPTIONS,
} from "../../../FeatureSet/Dashboard/src/Components/NetworkDevice/DeviceFacets";
import { DIAGNOSTIC_TIMEOUT_IN_MS } from "../../../FeatureSet/Dashboard/src/Components/NetworkDevice/DeviceDiagnosticsViewModel";
import {
  NO_MONITOR_QUALIFIER,
  NO_PROBE_QUALIFIER,
  NO_SNMP_INTERFACES_LABEL,
  SNMP_FAILING_QUALIFIER,
} from "../../../FeatureSet/Dashboard/src/Components/NetworkDevice/DeviceStatusUtil";
import { MONITORING_METHOD_OPTIONS } from "../../../FeatureSet/Dashboard/src/Components/NetworkDevice/MonitoringMethodFormFields";
import {
  ADD_DEVICE_MORE_FIELDS,
  ADD_DEVICE_PING_MONITOR_TITLE,
  ADD_DEVICE_SNMP_SECTION,
} from "../../../FeatureSet/Dashboard/src/Pages/NetworkDevice/AddDeviceForm";
import {
  DEFAULT_SNMP_VERSION,
  SNMP_V3_AUTH_PROTOCOL_DROPDOWN_OPTIONS,
  SNMP_V3_PRIV_PROTOCOL_DROPDOWN_OPTIONS,
  SNMP_V3_SECURITY_LEVEL_DROPDOWN_OPTIONS,
  SNMP_VERSION_DROPDOWN_OPTIONS,
} from "../../../FeatureSet/Dashboard/src/Pages/NetworkDevice/SnmpConfigFormFields";
import CriteriaFilterUtil from "../../../FeatureSet/Dashboard/src/Utils/Form/Monitor/CriteriaFilter";
import {
  NetworkSiteTypeOption,
  SITE_CSV_COLUMNS,
  SiteCsvParseResult,
  parseSiteCsv,
} from "../../../FeatureSet/Dashboard/src/Utils/NetworkSiteCsv";
import { readPage } from "./DocsContentSupport";
import {
  NETWORK_DEVICE_PAGE,
  NETWORK_SITES_PAGE,
  NETWORK_VENDOR_GUIDES_PAGE,
  sectionInLanguage,
} from "./NetworkDocsLabels";
import {
  DEFAULT_IPFIX_COLLECTOR_PORT,
  DEFAULT_NETFLOW_COLLECTOR_PORT,
  DEFAULT_SFLOW_COLLECTOR_PORT,
} from "Common/Types/NetFlow/NetworkFlowCollectorPorts";
import MonitorMetricType from "Common/Types/Monitor/MonitorMetricType";
import MonitorType from "Common/Types/Monitor/MonitorType";
import NetworkDeviceAlertPackUtil, {
  NetworkDeviceAlertPackItem,
} from "Common/Types/Monitor/SnmpMonitor/NetworkDeviceAlertPack";
import {
  MAX_DEVICE_SPECIFIC_OIDS,
  MAX_EFFECTIVE_OIDS_PER_DEVICE,
  MAX_OIDS_PER_TEMPLATE,
} from "Common/Types/Monitor/SnmpMonitor/SnmpOidListUtil";
import {
  SNMP_TABLE_COLUMN_ATTRIBUTE,
  SNMP_TABLE_COLUMN_OID_ATTRIBUTE,
  SNMP_TABLE_KEY_ATTRIBUTE,
  SNMP_TABLE_NAME_ATTRIBUTE,
  SNMP_TABLE_ROW_ATTRIBUTE,
  SNMP_TABLE_ROW_INDEX_ATTRIBUTE,
  SnmpTableDefinition,
} from "Common/Types/Monitor/SnmpMonitor/SnmpTable";
import {
  DEFAULT_SNMP_TABLE_MAX_ROWS,
  MAX_DEVICE_SPECIFIC_TABLES,
  MAX_SNMP_TABLE_MAX_ROWS,
  MAX_TABLES_PER_TEMPLATE,
} from "Common/Types/Monitor/SnmpMonitor/SnmpTableListUtil";
import SnmpVendorTemplateUtil, {
  SnmpVendorTemplate,
} from "Common/Types/Monitor/SnmpMonitor/SnmpVendorTemplate";
import {
  NETWORK_DEVICE_DIAGNOSTIC_PING_PACKET_COUNT,
  NETWORK_DEVICE_DIAGNOSTIC_RETENTION_IN_DAYS,
} from "Common/Types/NetworkDevice/NetworkDeviceDiagnosticResult";
import { NetworkDeviceMonitoringMethod } from "Common/Types/NetworkDevice/NetworkDeviceMonitoringMethod";
import { NETWORK_DEVICE_PING_ROUND_TRIP_TIME_METRIC_NAME } from "Common/Types/NetworkDevice/NetworkDevicePingMetricNames";
import DefaultNetworkSiteType from "Common/Types/NetworkSite/DefaultNetworkSiteType";
import { DefaultNetworkSiteTypeParent } from "Common/Types/NetworkSite/DefaultNetworkSiteTypeHierarchy";
import {
  DefaultSiteHealthRollupPolicy,
  DefaultSiteOfflineThresholdPercent,
  SiteHealthRollupPolicy,
  getSiteHealthRollupPolicyLabel,
} from "Common/Types/NetworkSite/SiteHealthRollupPolicy";
import Permission, { PermissionHelper } from "Common/Types/Permission";
import { DropdownOption } from "Common/UI/Components/Dropdown/Dropdown";
import TemplateVariablesCatalog, {
  TemplateVariable,
  TemplateVariableGroup,
} from "Common/UI/Components/MonitorTemplateVariables/TemplateVariablesCatalog";
import { UNNAMED_HOST_LABEL } from "Common/Utils/NetworkDiscovery/DiscoveredHostNamingDiagnosis";
import {
  MAX_NETBIOS_NAME_LENGTH,
  isNetbiosQueryableIPv4Address,
} from "Common/Utils/NetworkDiscovery/NetbiosNameUtil";
import { MINIMUM_RESCAN_INTERVAL_IN_MINUTES } from "Common/Utils/NetworkDiscovery/RescanIntervalUtil";
import ScanTargetUtil from "Common/Utils/NetworkDiscovery/ScanTargetUtil";
import { describe, expect, it } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * Docs overhaul task 17b: what the English Network Device Monitor, Network
 * Sites and Network Vendor Guides pages say about the product, held to the
 * code that makes it true.
 *
 * Markdown is not compiled, so nothing else notices when the Network menu
 * moves a page, a form field is renamed or folded, a dropdown gains an
 * option, a limit or a default changes, a vendor template is added, or the
 * probe's receivers move port. Each test reads the source of truth - the
 * dashboard's form and list helpers, Common's types and limits, the probe's
 * own sources (read as text: the probe is its own package), the workers'
 * schedules - and checks the page still says what it does. The translations
 * are held to these English pages by NetworkDocsTranslations; the menu
 * paths, verdicts and forms also by NetworkSimpleDocs, the bulk actions by
 * NetworkBulkAssignDocs, the optics by TransceiverDocs, the Wi-Fi vendors by
 * WifiVendorsDocs and the PDF export by TopologyPdfExportDocs.
 */

const PACKAGES_DIR: string = path.resolve(__dirname, "../../../..");

function readSource(relative: string): string {
  return fs.readFileSync(path.join(PACKAGES_DIR, relative), "utf8");
}

const DEVICE: string = readPage("en", NETWORK_DEVICE_PAGE);
const SITES: string = readPage("en", NETWORK_SITES_PAGE);
const VENDORS: string = readPage("en", NETWORK_VENDOR_GUIDES_PAGE);

const TABLE_DELIMITER_ROW: RegExp = /^\|\s*:?-/;

// The cells of a markdown table row.
function cells(row: string): Array<string> {
  return row
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell: string): string => {
      return cell.trim();
    });
}

/*
 * The body rows of the first table at or after the line that starts with
 * `marker`, as cells.
 */
function tableAfter(markdown: string, marker: string): Array<Array<string>> {
  const lines: Array<string> = markdown.split("\n");
  const at: number = lines.findIndex((line: string): boolean => {
    return line.startsWith(marker);
  });

  expect(at).toBeGreaterThan(-1);

  const start: number = lines.findIndex(
    (line: string, index: number): boolean => {
      return index >= at && line.startsWith("|");
    },
  );
  const rows: Array<Array<string>> = [];

  for (let index: number = start + 1; index < lines.length; index++) {
    const line: string = lines[index] as string;

    if (!line.startsWith("|")) {
      break;
    }

    if (!TABLE_DELIMITER_ROW.test(line)) {
      rows.push(cells(line));
    }
  }

  return rows;
}

function firstColumn(rows: Array<Array<string>>): Array<string> {
  return rows.map((row: Array<string>): string => {
    return (row[0] as string).replace(/^\*\*|\*\*$/g, "");
  });
}

function labelsOf(options: Array<{ label: string }>): Array<string> {
  return options.map((option: { label: string }): string => {
    return option.label;
  });
}

// "V1, V2c or V3": a list as the pages write it.
function spokenList(items: Array<string>): string {
  return `${items.slice(0, -1).join(", ")} or ${items[items.length - 1]}`;
}

// The text of a "default:" or "defaultValue:" a source declares for a field.
function declaredDefault(source: string, declaration: string): string {
  const at: number = source.indexOf(declaration);

  expect(at).toBeGreaterThan(-1);

  const before: string = source.slice(0, at);
  const blockStart: number = Math.max(
    before.lastIndexOf("public "),
    before.lastIndexOf("export const "),
  );
  const block: string = source.slice(blockStart, at + declaration.length);
  const match: RegExpMatchArray | null = block.match(
    /default(?:Value)?: ([^,\n]+),/,
  );

  expect(match).not.toBeNull();

  return (match![1] as string).trim();
}

// The Network menu as its source declares it: section titles, then items.
const SECTION_TITLE_LINE: RegExp = /^ {6}title: "([^"]+)",$/;
const ITEM_TITLE_LINE: RegExp = /^ {12}title: "([^"]+)",$/;

function networkMenu(): Map<string, Array<string>> {
  const menu: Map<string, Array<string>> = new Map();
  let current: string | null = null;

  for (const line of readSource(
    "App/FeatureSet/Dashboard/src/Components/Network/NetworkSideMenu.tsx",
  ).split("\n")) {
    const sectionMatch: RegExpMatchArray | null =
      line.match(SECTION_TITLE_LINE);

    if (sectionMatch) {
      current = sectionMatch[1] as string;
      menu.set(current, []);
      continue;
    }

    const itemMatch: RegExpMatchArray | null = line.match(ITEM_TITLE_LINE);

    if (itemMatch && current) {
      menu.get(current)!.push(itemMatch[1] as string);
    }
  }

  return menu;
}

const NETWORK_DEVICE_MODEL: string = readSource(
  "Common/Models/DatabaseModels/NetworkDevice.ts",
);
const PROBE_CONFIG: string = readSource("Probe/Config.ts");

// A probe setting's default, as Probe/Config.ts declares it.
function probeDefault(name: string): string {
  const match: RegExpMatchArray | null = PROBE_CONFIG.match(
    new RegExp(
      `export const ${name}: number =\\s*NumberUtil\\.parseNumberWithDefault\\(\\{[^}]*?defaultValue: (\\d+),`,
    ),
  );

  expect(match).not.toBeNull();

  return match![1] as string;
}

describe("the Network Device Monitor page: the Network area", () => {
  const menu: Map<string, Array<string>> = networkMenu();

  it("names the menu's open rows, in order", () => {
    const open: Array<string> = menu.get("Network") || [];

    expect(open.length).toBe(6);
    expect(DEVICE).toContain(
      `${open
        .slice(0, -1)
        .map((item: string): string => {
          return `**${item}**`;
        })
        .join(", ")} and **${open[open.length - 1]}**.`,
    );
  });

  it("lists every folded section with its pages, in the menu's order", () => {
    const folded: Array<[string, Array<string>]> = Array.from(
      menu.entries(),
    ).filter(([title]: [string, Array<string>]): boolean => {
      return title !== "Network";
    });
    const documented: Array<[string, Array<string>]> = tableAfter(
      DEVICE,
      "| Section | Pages |",
    ).map((row: Array<string>): [string, Array<string>] => {
      return [
        (row[0] as string).replace(/\*\*/g, ""),
        (row[1] as string).split(", ").map((item: string): string => {
          return item.replace(/\*\*/g, "");
        }),
      ];
    });

    expect(documented).toEqual(folded);
  });
});

describe("the Network Device Monitor page: adding a device", () => {
  const form: string = readSource(
    "App/FeatureSet/Dashboard/src/Pages/NetworkDevice/Devices.tsx",
  );
  const formFields: string = form.slice(form.indexOf("formFields={["));
  const deviceRows: Array<Array<string>> = tableAfter(DEVICE, "### The device");

  it.each(["Hostname", "Name", "Site", "Probe"])(
    "says whether %s is required as the form does",
    (title: string) => {
      const match: RegExpMatchArray | null = formFields.match(
        new RegExp(`title: "${title}",[\\s\\S]*?required: (true|false)`),
      );
      const row: Array<string> | undefined = deviceRows.find(
        (candidate: Array<string>): boolean => {
          return candidate[0] === title;
        },
      );

      expect(match).not.toBeNull();
      expect(row).toBeDefined();
      expect((row as Array<string>)[2]).toBe(
        match![1] === "true" ? "Yes" : "No",
      );
    },
  );

  it("folds SNMP and More fields, and puts the Ping monitor opt-in under More fields", () => {
    expect(DEVICE).toContain(`### ${ADD_DEVICE_MORE_FIELDS.title} (folded)`);
    expect(DEVICE).toContain(
      `### ${ADD_DEVICE_SNMP_SECTION.title} (folded, optional)`,
    );
    expect(
      firstColumn(tableAfter(DEVICE, "### More fields (folded)")),
    ).toContain(ADD_DEVICE_PING_MONITOR_TITLE);
  });

  it("offers the SNMP versions the form offers, starting on its default", () => {
    const versions: Array<string> = labelsOf(SNMP_VERSION_DROPDOWN_OPTIONS);

    expect(DEVICE).toContain(
      `| SNMP Version | ${spokenList(versions)}. | Yes, starts on ${DEFAULT_SNMP_VERSION} |`,
    );
    expect(declaredDefault(NETWORK_DEVICE_MODEL, "public snmpVersion?:")).toBe(
      `"${DEFAULT_SNMP_VERSION}"`,
    );
  });

  it("offers the v3 security levels and protocols the form offers", () => {
    const levels: Array<string> = labelsOf(
      SNMP_V3_SECURITY_LEVEL_DROPDOWN_OPTIONS,
    );

    expect(DEVICE).toContain(
      `| SNMP v3 Security Level | ${levels.slice(0, -1).join("; ")}; or ${levels[levels.length - 1]}. |`,
    );
    expect(DEVICE).toContain(
      `| SNMP v3 Authentication Protocol | ${spokenList(
        labelsOf(SNMP_V3_AUTH_PROTOCOL_DROPDOWN_OPTIONS),
      )}. |`,
    );
    expect(DEVICE).toContain(
      `| SNMP v3 Privacy Protocol | ${spokenList(
        labelsOf(SNMP_V3_PRIV_PROTOCOL_DROPDOWN_OPTIONS),
      )}. |`,
    );
  });

  it("says the agent's port defaults to the device's column default", () => {
    const port: string = declaredDefault(
      NETWORK_DEVICE_MODEL,
      "public snmpPort?:",
    );

    expect(DEVICE).toContain(
      `| SNMP Port | The UDP port the agent listens on. | No, ${port} by default |`,
    );
  });
});

describe("the Network Device Monitor page: a device's status", () => {
  it("quotes the verdicts the status filter offers", () => {
    expect(firstColumn(tableAfter(DEVICE, "| Verdict | Means |"))).toEqual(
      labelsOf(DEVICE_STATUS_FACET_OPTIONS),
    );
  });

  it("quotes the qualifiers the lists draw beside a verdict", () => {
    expect(
      firstColumn(
        tableAfter(DEVICE, "| Qualifier | Shown when | What to do |"),
      ),
    ).toEqual([
      "Stale",
      NO_PROBE_QUALIFIER.text,
      NO_MONITOR_QUALIFIER.text,
      SNMP_FAILING_QUALIFIER.text,
    ]);
  });

  it("names the SNMP filter's values and what the Interfaces column reads without a walk", () => {
    const values: Array<string> = labelsOf(DEVICE_SNMP_FACET_OPTIONS);

    expect(values.length).toBe(3);
    expect(DEVICE).toContain(
      `an **SNMP** filter with three values: **${values[0]}**`,
    );

    for (const value of values) {
      expect(DEVICE).toContain(`**${value}** (`);
    }

    expect(DEVICE).toContain(
      `reads **${NO_SNMP_INTERFACES_LABEL.text}** rather than \`0 / 0\``,
    );
  });

  it("offers the two monitoring methods the Settings form offers, Probe by default", () => {
    const methods: Array<string> = MONITORING_METHOD_OPTIONS.map(
      (option: DropdownOption): string => {
        return (option.label as string).split(" — ")[0] as string;
      },
    );

    expect(
      firstColumn(tableAfter(DEVICE, "| Method | What it means |")),
    ).toEqual(methods);
    expect(
      declaredDefault(NETWORK_DEVICE_MODEL, "public monitoringMethod?:"),
    ).toBe("NetworkDeviceMonitoringMethod.Probe");
    expect(MONITORING_METHOD_OPTIONS[0]!.value).toBe(
      NetworkDeviceMonitoringMethod.Probe,
    );
  });
});

describe("the Network Device Monitor page: polling", () => {
  const polling: Array<Array<string>> = tableAfter(
    DEVICE,
    "| Setting | Description | Default |",
  );

  function documentedDefault(setting: string): string {
    const row: Array<string> | undefined = polling.find(
      (candidate: Array<string>): boolean => {
        return candidate[0] === setting;
      },
    );

    expect(row).toBeDefined();

    return (row as Array<string>)[2] as string;
  }

  it.each([
    ["Polling Enabled", "public isPollingEnabled?:", "On"],
    ["Walk Interfaces", "public walkInterfaces?:", "On"],
    ["Collect Connected Endpoints", "public collectEndpoints?:", "Off"],
  ])(
    "%s starts as the device's column does",
    (setting: string, declaration: string, documented: string) => {
      const declared: string = declaredDefault(
        NETWORK_DEVICE_MODEL,
        declaration,
      );

      expect(declared).toBe(documented === "On" ? "true" : "false");
      expect(documentedDefault(setting)).toBe(documented);
    },
  );

  it("polls every 5 minutes unless told otherwise", () => {
    expect(
      declaredDefault(
        NETWORK_DEVICE_MODEL,
        "public pollingIntervalInMinutes?:",
      ),
    ).toBe(documentedDefault("Polling Interval (Minutes)"));
  });

  it("auto-applies vendor templates only where discovery imports", () => {
    expect(
      declaredDefault(
        NETWORK_DEVICE_MODEL,
        "public autoApplyVendorHealthTemplate?:",
      ),
    ).toBe("false");
    expect(documentedDefault("Auto-Apply Vendor Health Template")).toBe(
      "Off; on for devices discovery imports",
    );
  });
});

describe("the Network Device Monitor page: OIDs and SNMP tables", () => {
  it("states the OID limits the device and template writes enforce", () => {
    expect(tableAfter(DEVICE, "| Limit | Value |")).toEqual([
      ["Health OIDs a device polls", String(MAX_EFFECTIVE_OIDS_PER_DEVICE)],
      ["OIDs on a template", String(MAX_OIDS_PER_TEMPLATE)],
      ["A linked device's own OIDs", String(MAX_DEVICE_SPECIFIC_OIDS)],
      ["An unlinked device's own OIDs", String(MAX_EFFECTIVE_OIDS_PER_DEVICE)],
    ]);
    expect(DEVICE).toContain(
      `a linked device can never poll more than ${MAX_EFFECTIVE_OIDS_PER_DEVICE} OIDs`,
    );
    expect(DEVICE).toContain(
      `already has more than ${MAX_DEVICE_SPECIFIC_OIDS} of its own is refused`,
    );
  });

  it("states the row and table limits a table definition may have", () => {
    expect(DEVICE).toContain(
      `| Row limit | How many rows to keep: ${DEFAULT_SNMP_TABLE_MAX_ROWS} by default, ${MAX_SNMP_TABLE_MAX_ROWS} at most. |`,
    );
    expect(DEVICE).toContain(
      `shared by every linked device (up to ${MAX_TABLES_PER_TEMPLATE} tables)`,
    );
    expect(DEVICE).toContain(
      `under **Device-Specific SNMP Tables** (up to ${MAX_DEVICE_SPECIFIC_TABLES} more)`,
    );
    expect(DEVICE).toContain(
      `A controller's table keeps up to ${MAX_SNMP_TABLE_MAX_ROWS} rows`,
    );
  });

  it("gives the tables the walk budget the probe gives them", () => {
    const match: RegExpMatchArray | null = readSource(
      "Probe/Utils/Monitors/MonitorTypes/SnmpMonitor.ts",
    ).match(/const TABLE_WALK_BUDGET_MS: number = (\d+);/);

    expect(match).not.toBeNull();
    expect(DEVICE).toContain(
      `within a ${Number(match![1]) / 1000}-second budget shared by every table on the device`,
    );
  });

  it("names the series and the attributes every numeric cell is written with", () => {
    const attributes: Array<string> = [
      SNMP_TABLE_KEY_ATTRIBUTE,
      SNMP_TABLE_NAME_ATTRIBUTE,
      SNMP_TABLE_COLUMN_ATTRIBUTE,
      SNMP_TABLE_COLUMN_OID_ATTRIBUTE,
      SNMP_TABLE_ROW_ATTRIBUTE,
      SNMP_TABLE_ROW_INDEX_ATTRIBUTE,
    ].map((attribute: string): string => {
      return `\`${attribute}\``;
    });

    expect(DEVICE).toContain(
      `recorded as the metric \`${MonitorMetricType.SnmpTableValue}\`, with the attributes ${attributes.slice(0, -1).join(", ")} and ${attributes[attributes.length - 1]},`,
    );
  });

  it("names the ping series a device's round-trip time and packet loss go to", () => {
    expect(DEVICE).toContain(
      `Round-trip time has a series of its own, \`${NETWORK_DEVICE_PING_ROUND_TRIP_TIME_METRIC_NAME}\``,
    );
    expect(
      readSource("Common/Server/Utils/Monitor/NetworkDeviceMetricUtil.ts"),
    ).toContain("MonitorMetricType.PacketLossPercent");
  });
});

describe("the Network Device Monitor page: vendor templates", () => {
  const templates: Array<SnmpVendorTemplate> = SnmpVendorTemplateUtil.getAll();
  const rows: Array<Array<string>> = tableAfter(
    DEVICE,
    "| Vendor template | Health OIDs | SNMP tables |",
  );

  it("lists every vendor template, in the dropdown's order", () => {
    expect(firstColumn(rows)).toEqual(
      templates.map((template: SnmpVendorTemplate): string => {
        return template.label;
      }),
    );
  });

  it.each(
    templates.map((template: SnmpVendorTemplate): [string, boolean] => {
      return [template.label, (template.tables || []).length > 0];
    }),
  )(
    "%s: names its tables exactly when it ships some",
    (label: string, hasTables: boolean) => {
      const row: Array<string> = rows.find(
        (candidate: Array<string>): boolean => {
          return candidate[0] === label;
        },
      ) as Array<string>;

      expect(row[2] !== "—").toBe(hasTables);
    },
  );

  it.each([
    [
      "1.3.6.1.4.1.1916.2.325",
      "7520-48Y-8C-FabricEngine (9.0.4.0)",
      "extreme-fabric-engine",
    ],
    [
      "1.3.6.1.4.1.1916.2.325",
      "ExtremeXOS (X465-24W) version 31.7.1.4",
      "extreme-exos",
    ],
    ["1.3.6.1.4.1.2272.202", "VSP-8284XSQ (8.1.0.0)", "extreme-fabric-engine"],
    ["1.3.6.1.4.1.41112.1.6", "U6-Pro 6.6.50.15098", "ubiquiti-unifi-ap"],
    ["1.3.6.1.4.1.8072.3.2.10", "U6-Pro 6.6.50.15098", "ubiquiti-unifi-ap"],
    ["1.3.6.1.4.1.26928.1.1.1", "AP230, HiveOS 8.2r1", "extreme-iq-engine-ap"],
  ])(
    "matches %s / %s to the template the page says",
    (sysObjectId: string, sysDescr: string, templateId: string) => {
      expect(
        SnmpVendorTemplateUtil.matchDevice({ sysObjectId, sysDescr })?.id,
      ).toBe(templateId);
    },
  );

  it("quotes the descriptions it matches on", () => {
    expect(DEVICE).toContain("(`…-FabricEngine (9.0.4.0)`)");
    expect(DEVICE).toContain("(`U6-Pro 6.6.50.15098`)");
    expect(DEVICE).toContain("(`AP230, HiveOS 8.2r1`)");
    expect(DEVICE).toContain("the same enterprise (1916) as EXOS");
  });

  it("leaves TP-Link's template for the reader to apply", () => {
    expect(
      SnmpVendorTemplateUtil.matchDevice({
        sysObjectId: "1.3.6.1.4.1.11863.1.1.1",
        sysDescr: "EAP245(EU) v3.0",
      })?.id,
    ).not.toBe("tplink-omada-eap");
    expect(DEVICE).toContain("except TP-Link's, which you apply yourself");
  });

  it("gives the Sophos tunnel status column the page uses as its example", () => {
    const tunnels: SnmpTableDefinition | undefined =
      SnmpVendorTemplateUtil.getById("sophos-sfos")?.tables?.find(
        (table: SnmpTableDefinition): boolean => {
          return table.key === "ipsec_tunnels";
        },
      );
    const statusColumn: string = "1.3.6.1.4.1.2604.5.1.6.1.1.1.1.9";

    expect(
      tunnels?.columns.some((column: { oid: string }): boolean => {
        return column.oid === statusColumn;
      }),
    ).toBe(true);
    expect(DEVICE).toContain(
      `\`${statusColumn}\` for a Sophos tunnel's status`,
    );
  });
});

describe("the Network Device Monitor page: alerting", () => {
  it("lists every criteria the Network Device monitor offers, and no other", () => {
    expect(
      firstColumn(
        tableAfter(
          DEVICE,
          "| Filter type | What it checks | On a ping-only poll |",
        ),
      ).sort(),
    ).toEqual(
      CriteriaFilterUtil.getCheckOnOptionsByMonitorType(
        MonitorType.NetworkDevice,
      )
        .map((option: DropdownOption): string => {
          return option.label as string;
        })
        .sort(),
    );
  });

  it("lists the recommended alert pack, with what each item creates", () => {
    expect(
      tableAfter(DEVICE, "| Criteria | Fires when | Creates |").map(
        (row: Array<string>): [string, string] => {
          return [row[0] as string, row[2] as string];
        },
      ),
    ).toEqual(
      NetworkDeviceAlertPackUtil.getPackItems().map(
        (item: NetworkDeviceAlertPackItem): [string, string] => {
          return [item.name, item.createIncidents ? "Incident" : "Alert"];
        },
      ),
    );
  });

  it("states the pack's utilization and error thresholds", () => {
    const valueOf: (name: string) => unknown = (name: string): unknown => {
      return NetworkDeviceAlertPackUtil.getPackItems().find(
        (item: NetworkDeviceAlertPackItem): boolean => {
          return item.name === name;
        },
      )?.filters[0]?.value;
    };

    expect(DEVICE).toContain(
      `An interface runs above ${valueOf("Interface saturated")}% utilization.`,
    );
    expect(DEVICE).toContain(
      `An interface logs more than ${valueOf("Interface errors")} error per second.`,
    );
  });

  it.each([
    ["sophos-sfos", "IPsec Tunnels: row unhealthy", true],
    ["extreme-wireless-controller", "Access Points: row unhealthy", true],
    [
      "extreme-fabric-engine",
      "Fabric Adjacencies (IS-IS): row unhealthy",
      true,
    ],
    ["extreme-exos", "Power Supplies: row unhealthy", false],
  ])(
    "%s's table health item %s is an incident: %s",
    (templateId: string, name: string, isIncident: boolean) => {
      const item: NetworkDeviceAlertPackItem | undefined =
        NetworkDeviceAlertPackUtil.getTableHealthItems(
          SnmpVendorTemplateUtil.getById(templateId)?.tables,
        ).find((candidate: NetworkDeviceAlertPackItem): boolean => {
          return candidate.name === name;
        });

      expect(item?.createIncidents).toBe(isIncident);
    },
  );

  it("names the table health items the vendor guide and the pack section quote", () => {
    expect(DEVICE).toContain('("IPsec Tunnels: row unhealthy"');
    expect(DEVICE).toContain('"Access Points: row unhealthy"');
    expect(VENDORS).toContain("**IPsec Tunnels: row unhealthy**");
    expect(VENDORS).toContain("**Fabric Adjacencies (IS-IS): row unhealthy**");
  });

  it("keeps a policy's monitors in step on the sweep the worker runs", () => {
    expect(
      readSource(
        "App/FeatureSet/Workers/Jobs/NetworkAlertPolicy/ReconcilePolicies.ts",
      ),
    ).toContain("schedule: EVERY_FIVE_MINUTE,");
    expect(DEVICE).toContain(
      "a sweep every five minutes brings larger changes in",
    );
  });
});

describe("the Network Device Monitor page: the template variables", () => {
  const variables: Array<string> = (
    TemplateVariablesCatalog.getVariables({
      monitorType: MonitorType.NetworkDevice,
    }).find((group: TemplateVariableGroup): boolean => {
      return group.title === "Network Device (SNMP)";
    })?.variables || []
  ).map((variable: TemplateVariable): string => {
    return variable.key;
  });
  const documented: Array<string> = firstColumn(
    tableAfter(DEVICE, "| Variable | Description |"),
  ).flatMap((cell: string): Array<string> => {
    return Array.from(cell.matchAll(/`\{\{([^}]+)\}\}`/g)).map(
      (match: RegExpMatchArray): string => {
        return match[1] as string;
      },
    );
  });

  it("documents every variable the template editor offers a Network Device monitor", () => {
    expect(variables.length).toBeGreaterThan(10);

    for (const key of variables) {
      expect({ key, documented: documented.includes(key) }).toEqual({
        key,
        documented: true,
      });
    }
  });

  it("documents only variables the editor offers, an OID's own name, and the unhealthy row count", () => {
    for (const key of documented) {
      expect({
        key,
        offered:
          variables.includes(key) ||
          key === "OID_NAME" ||
          key === "tables.<key>.unhealthyRowCount",
      }).toEqual({ key, offered: true });
    }

    expect(
      readSource("Common/Server/Utils/Monitor/SnmpTableTemplateUtil.ts"),
    ).toContain("unhealthyRowCount");
  });
});

describe("the Network Device Monitor page: receivers on the probe", () => {
  it("lists the trap receiver's settings with the probe's defaults", () => {
    expect(PROBE_CONFIG).toContain(
      'process.env["PROBE_SNMP_TRAP_RECEIVER_ENABLED"] !== "false"',
    );
    expect(tableAfter(DEVICE, "| Environment variable |")).toEqual([
      [
        "`PROBE_SNMP_TRAP_RECEIVER_ENABLED`",
        "Set to `false` to turn the trap receiver off.",
        "`true`",
      ],
      [
        "`PROBE_SNMP_TRAP_RECEIVER_PORT`",
        "The UDP port the receiver listens on.",
        `\`${probeDefault("PROBE_SNMP_TRAP_RECEIVER_PORT")}\``,
      ],
      [
        "`PROBE_SNMP_TRAP_RATE_LIMIT_PER_MINUTE`",
        "How many traps it forwards per minute before dropping the rest.",
        `\`${probeDefault("PROBE_SNMP_TRAP_RATE_LIMIT_PER_MINUTE")}\``,
      ],
    ]);
  });

  it("names the ports the probe takes traps, syslog and flows on, syslog only once turned on", () => {
    expect(PROBE_CONFIG).toContain(
      'process.env["PROBE_SYSLOG_RECEIVER_ENABLED"] === "true"',
    );
    expect(DEVICE).toContain(
      `The probe takes SNMP traps on UDP ${probeDefault("PROBE_SNMP_TRAP_RECEIVER_PORT")}, syslog on UDP ${probeDefault("PROBE_SYSLOG_RECEIVER_PORT")} once you turn it on, and flow records on UDP ${DEFAULT_NETFLOW_COLLECTOR_PORT}, ${DEFAULT_IPFIX_COLLECTOR_PORT} and ${DEFAULT_SFLOW_COLLECTOR_PORT}`,
    );
  });
});

describe("the Network Device Monitor page: discovery", () => {
  it.each([
    ["192.168.1.0/24", 254],
    ["10.0.0.0/31", 2],
    ["10.0.0.5/32", 1],
    ["10.0.0.5", 1],
    ["10.16-22.0-255.51-66", 28672],
  ])(
    "%s sweeps %i addresses, as the page counts them",
    (target: string, hosts: number) => {
      expect(ScanTargetUtil.countHosts(target)).toBe(hosts);
    },
  );

  it("skips a /24's network and broadcast addresses, and keeps an octet range's", () => {
    expect(DEVICE).toContain("so a `/24` sweeps 254 hosts");
    expect(ScanTargetUtil.expand("10.0.0.0-255")).toContain("10.0.0.0");
    expect(ScanTargetUtil.expand("10.0.0.0-255")).toContain("10.0.0.255");
  });

  it("refuses a reversed range", () => {
    expect(ScanTargetUtil.isValid("10.22-16.0.1")).toBe(false);
    expect(DEVICE).toContain("`10.22-16.0.1` is refused as a reversed range");
  });

  it("caps a scan where the scan target check does", () => {
    expect(DEVICE).toContain(
      `One scan covers at most ${ScanTargetUtil.MAX_SCAN_HOSTS.toLocaleString("en-US")} addresses.`,
    );
    expect(ScanTargetUtil.countHosts("10.0.0.0/17")).toBeLessThanOrEqual(
      ScanTargetUtil.MAX_SCAN_HOSTS,
    );
    expect(ScanTargetUtil.getValidationError("10.0.0.0/17")).toBeNull();
    expect(ScanTargetUtil.getValidationError("10.0.0.0/16")).not.toBeNull();
  });

  it("works out the octet range example's share of its smallest CIDR block", () => {
    const covered: number = ScanTargetUtil.countHosts("10.16-22.0-255.51-66");
    const block: number = 2 ** (32 - 13);
    const wasted: number = Math.round(100 * (1 - covered / block));

    expect(DEVICE).toContain(
      `sweeps \`.51\` to \`.66\` in every \`/24\` from \`10.16\` to \`10.22\`: ${covered.toLocaleString("en-US")} addresses.`,
    );
    expect(DEVICE).toContain(
      `(\`10.16.0.0/13\`) is ${block / 1024}k addresses, ${wasted}% of them not worth probing`,
    );
  });

  it("repeats a scan no more often than the rescan floor", () => {
    expect(DEVICE).toContain(
      `the **Rescan Interval (Minutes)**, at least ${MINIMUM_RESCAN_INTERVAL_IN_MINUTES} minutes`,
    );
  });

  it("asks NetBIOS names only of private and carrier-grade NAT addresses", () => {
    for (const address of [
      "10.0.0.5",
      "172.16.0.5",
      "192.168.1.5",
      "100.64.0.5",
    ]) {
      expect({
        address,
        asked: isNetbiosQueryableIPv4Address(address),
      }).toEqual({
        address,
        asked: true,
      });
    }

    expect(isNetbiosQueryableIPv4Address("8.8.8.8")).toBe(false);
    expect(DEVICE).toContain(
      "Only hosts at private (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`) and carrier-grade NAT (`100.64.0.0/10`) addresses are asked.",
    );
  });

  it("states NetBIOS's name length and the probe's host cap", () => {
    const match: RegExpMatchArray | null = readSource(
      "Probe/Utils/Discovery/NetbiosNameResolver.ts",
    ).match(/export const DEFAULT_NETBIOS_MAX_HOSTS: number = (\d+);/);

    expect(match).not.toBeNull();
    expect(DEVICE).toContain(
      `NetBIOS cuts a computer name to ${MAX_NETBIOS_NAME_LENGTH} characters`,
    );
    expect(DEVICE).toContain(
      `is used only when it is 1 to ${MAX_NETBIOS_NAME_LENGTH} characters`,
    );
    expect(DEVICE).toContain(
      `The lookup asks at most ${Number(match![1]).toLocaleString("en-US")} hosts per scan`,
    );
  });

  it("names a host with no name as Review Results does", () => {
    expect(DEVICE).toContain(`shows **${UNNAMED_HOST_LABEL}** and an (i)`);
  });

  it("reaches back as far as the rule engine does when a rule is saved", () => {
    const match: RegExpMatchArray | null = readSource(
      "Common/Server/Services/NetworkDeviceAutoImportRuleEngineService.ts",
    ).match(/export const MAX_RESULT_AGE_IN_HOURS: number = (\d+);/);

    expect(match).not.toBeNull();
    expect(DEVICE).toContain(
      `reaches hosts discovered in the last ${match![1]} hours`,
    );
  });
});

describe("the Network Device Monitor page: ping and traceroute from the map", () => {
  const drawer: string = sectionInLanguage(
    "en",
    NETWORK_DEVICE_PAGE,
    "### Ping and traceroute from the map",
  );
  const words: Record<number, string> = { 2: "two", 5: "five", 10: "ten" };

  it("sends as many echo requests as a diagnostic does", () => {
    expect(drawer).toContain(
      `**Ping** sends ${words[NETWORK_DEVICE_DIAGNOSTIC_PING_PACKET_COUNT]} ICMP echo requests`,
    );
  });

  it("waits as long as the drawer does, on a probe that fetches every ten seconds", () => {
    expect(
      readSource("Probe/Jobs/NetworkDevice/FetchDiagnostics.ts"),
    ).toContain("schedule: EVERY_TEN_SECONDS,");
    expect(drawer).toContain("within about ten seconds");
    expect(drawer).toContain(
      `within ${words[DIAGNOSTIC_TIMEOUT_IN_MS / 60000]} minutes`,
    );
  });

  it("keeps results as long as the service does, behind the permission it checks", () => {
    expect(drawer).toContain(
      `Results are kept for ${words[NETWORK_DEVICE_DIAGNOSTIC_RETENTION_IN_DAYS]} days and then deleted.`,
    );
    expect(drawer).toContain(
      `**${PermissionHelper.getTitle(Permission.CreateNetworkDeviceDiagnostic)}** permission`,
    );
  });
});

describe("the Network Sites page", () => {
  it("lists the site types a new project starts with, top down", () => {
    const chain: Array<string> = [];
    let current: DefaultNetworkSiteType | undefined = Object.values(
      DefaultNetworkSiteType,
    ).find((type: DefaultNetworkSiteType): boolean => {
      return (
        DefaultNetworkSiteTypeParent[type] === null &&
        Object.values(DefaultNetworkSiteType).some(
          (child: DefaultNetworkSiteType): boolean => {
            return DefaultNetworkSiteTypeParent[child] === type;
          },
        )
      );
    });

    while (current) {
      chain.push(current);
      const parent: DefaultNetworkSiteType = current;
      current = Object.values(DefaultNetworkSiteType).find(
        (type: DefaultNetworkSiteType): boolean => {
          return DefaultNetworkSiteTypeParent[type] === parent;
        },
      );
    }

    const loose: Array<string> = Object.values(DefaultNetworkSiteType).filter(
      (type: DefaultNetworkSiteType): boolean => {
        return !chain.includes(type);
      },
    );

    expect(SITES).toContain(
      `a new project starts with ${chain.slice(0, -1).join(", ")} and ${chain[chain.length - 1]}, in that order from the top, plus ${loose.join(" and ")}.`,
    );
  });

  it("names the rollup policies as Health Rollup does, with the default marked", () => {
    expect(DefaultSiteHealthRollupPolicy).toBe(
      SiteHealthRollupPolicy.WorstStatus,
    );
    expect(SITES).toContain(
      `### ${getSiteHealthRollupPolicyLabel(SiteHealthRollupPolicy.WorstStatus)} (default)`,
    );
    expect(SITES).toContain(
      `### ${getSiteHealthRollupPolicyLabel(SiteHealthRollupPolicy.PercentThreshold)}`,
    );
    expect(SITES).toContain(
      `**${getSiteHealthRollupPolicyLabel(SiteHealthRollupPolicy.PercentThreshold)}**`,
    );
  });

  it("gives the offline threshold its default", () => {
    expect(SITES).toContain(
      `as **Offline Threshold (%)**, and is ${DefaultSiteOfflineThresholdPercent} by default.`,
    );
  });

  it("names the uptime windows and the daily bars the Status Timeline draws", () => {
    const timeline: string = readSource(
      "App/FeatureSet/Dashboard/src/Pages/NetworkSite/View/StatusTimeline.tsx",
    );

    expect(timeline).toContain(
      "const UPTIME_WINDOWS_IN_DAYS: Array<number> = [1, 7, 30, 90];",
    );
    expect(timeline).toContain("const DAILY_STRIP_DAYS: number = 30;");
    expect(SITES).toContain(
      "shows the last 24 hours, 7, 30 and 90 days, and a bar per day for the last 30.",
    );
  });

  it("recomputes stale rollups on the sweep the worker runs", () => {
    expect(
      readSource(
        "App/FeatureSet/Workers/Jobs/NetworkSite/RecomputeStaleRollups.ts",
      ),
    ).toContain("schedule: EVERY_FIVE_MINUTE,");
    expect(SITES).toContain("and by a sweep every five minutes");
  });

  it("documents the CSV columns the importer reads, and its example imports", () => {
    const example: string = SITES.slice(
      SITES.indexOf('```csv title="sites.csv"\n') +
        '```csv title="sites.csv"\n'.length,
    ).split("\n```")[0] as string;
    const types: Array<NetworkSiteTypeOption> = [
      { id: "region", name: "Region", parentNetworkSiteTypeId: null },
      { id: "market", name: "Market", parentNetworkSiteTypeId: "region" },
      {
        id: "unit",
        name: "Unit",
        parentNetworkSiteTypeId: "market",
        isUnitLevel: true,
      },
    ];
    const parsed: SiteCsvParseResult = parseSiteCsv(example, types);

    expect(example.split("\n")[0]).toBe(SITE_CSV_COLUMNS.join(","));
    expect(parsed.errors).toEqual([]);
    expect(parsed.rows.length).toBe(3);
    expect(SITES).toContain(
      "- `name` and `siteType` are required. `siteType` must be one of the project's site types.",
    );
  });
});

describe("the Network Vendor Guides page", () => {
  it.each([
    ["sophos-sfos", ["ipsec_tunnels"]],
    ["extreme-exos", []],
    ["extreme-fabric-engine", ["isis_adjacencies"]],
    ["cambium-wifi-ap", ["wifi_radios"]],
    ["cambium-cnmatrix", []],
  ])(
    "names the %s template as the dropdown does, and the tables it quotes by key",
    (templateId: string, keys: Array<string>) => {
      const template: SnmpVendorTemplate | undefined =
        SnmpVendorTemplateUtil.getById(templateId);

      expect(template).toBeDefined();
      expect(VENDORS).toContain(`**${template!.label}**`);

      for (const key of keys) {
        expect(
          (template!.tables || []).some(
            (table: SnmpTableDefinition): boolean => {
              return table.key === key;
            },
          ),
        ).toBe(true);
        expect(VENDORS).toContain(`\`${key}\``);
      }
    },
  );

  it("sends flows and syslog to the ports the probe listens on", () => {
    expect(VENDORS).toContain(
      `Send it to the probe on UDP ${DEFAULT_NETFLOW_COLLECTOR_PORT}`,
    );
    expect(VENDORS).toContain(
      `Send sFlow to the probe on UDP ${DEFAULT_SFLOW_COLLECTOR_PORT}, or IPFIX on UDP ${DEFAULT_IPFIX_COLLECTOR_PORT}`,
    );
    expect(VENDORS).toContain(
      `It listens on UDP ${probeDefault("PROBE_SYSLOG_RECEIVER_PORT")} by default`,
    );
    expect(VENDORS).toContain("The probe's syslog receiver is off by default");
  });

  it("tells Fabric Engine from EXOS by the description it quotes", () => {
    expect(
      SnmpVendorTemplateUtil.matchDevice({
        sysObjectId: "1.3.6.1.4.1.1916.2.325",
        sysDescr: "7520-48Y-8C-FabricEngine (9.0.4.0)",
      })?.label,
    ).toBe(SnmpVendorTemplateUtil.getById("extreme-fabric-engine")!.label);
    expect(VENDORS).toContain("(`7520-48Y-8C-FabricEngine (9.0.4.0)`)");
  });

  it("numbers SFOS's cores as the CPU table's note says", () => {
    expect(
      readSource("Common/Types/Monitor/SnmpMonitor/SnmpVendorTemplate.ts"),
    ).toContain("number their processors from 196608");
    expect(VENDORS).toContain("SFOS numbers its cores from 196608");
  });
});

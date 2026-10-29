/*
 * The Inventory pages and the API reference, by the paths their suites name
 * them with, and the words they keep as the product writes them.
 *
 * Docs overhaul task 26b rewrote these pages: InventoryDocsFacts and
 * ApiReferenceDocsFacts hold the English pages to the product, and
 * InventoryAndApiDocsTranslations holds every translation to its English
 * page. They read the page lists and the kept words from here, never from
 * each other: importing a .test.ts file runs its tests.
 */

export interface InventoryAndApiDocsPageEntry {
  page: string;
  // The page's nav link, as the docs' English locale keys it.
  navTitle: string;
}

export const INVENTORY_OVERVIEW: string = "inventory/overview";
export const INVENTORY_CUSTOM_FIELDS: string = "inventory/custom-fields";
export const CMDB_SYNC: string = "inventory/cmdb-sync";
export const API_REFERENCE: string = "api-reference/api-reference";

// The Inventory nav group, in nav order.
export const INVENTORY_PAGES: ReadonlyArray<InventoryAndApiDocsPageEntry> = [
  { page: INVENTORY_OVERVIEW, navTitle: "Inventory Overview" },
  { page: INVENTORY_CUSTOM_FIELDS, navTitle: "Inventory Custom Fields" },
  { page: CMDB_SYNC, navTitle: "Exporting to a CMDB" },
];

// The API Reference nav group: one page.
export const API_REFERENCE_PAGES: ReadonlyArray<InventoryAndApiDocsPageEntry> =
  [{ page: API_REFERENCE, navTitle: "OneUptime API Reference" }];

export const INVENTORY_AND_API_PAGES: ReadonlyArray<InventoryAndApiDocsPageEntry> =
  [...INVENTORY_PAGES, ...API_REFERENCE_PAGES];

/*
 * A table's create button, drawn as translateCreateAction draws it: the
 * custom fields table's and the API keys table's ("Create <singular
 * name>"), and the Inventory list's, whose table names its own verb
 * (createVerb "Add").
 */
export const CREATE_BUTTONS: Readonly<Record<string, ReadonlyArray<string>>> = {
  [INVENTORY_OVERVIEW]: ["Add Item"],
  [INVENTORY_CUSTOM_FIELDS]: ["Create Inventory Item Custom Field"],
  [CMDB_SYNC]: ["Create API Key"],
  [API_REFERENCE]: ["Create API Key"],
};

/*
 * Labels the Dashboard looks up whole (translateString), never through a
 * "Delete {{itemName}}" or "Add {{itemName}}" template: an item's side menu
 * entry (SideMenuItem), and the buttons of an API key's Permissions card
 * (Card draws each button's title as it is). Where a locale has no wording
 * of its own, the Dashboard draws the English.
 */
export const WHOLE_LABELS: Readonly<Record<string, ReadonlyArray<string>>> = {
  [INVENTORY_OVERVIEW]: ["Delete Item"],
  [CMDB_SYNC]: ["Add Permission"],
  [API_REFERENCE]: ["Add Role", "Add Permission"],
};

/*
 * A permission's name, as the team and API key permission pickers list it
 * (Permission.ts's title, which no locale translates), so every page keeps
 * it as written although "Edit Telemetry Service" reads like a button.
 */
export const PERMISSION_NAMES: Readonly<Record<string, ReadonlyArray<string>>> =
  {
    [CMDB_SYNC]: [
      "Read Telemetry Service",
      "Edit Telemetry Service",
      "Create Telemetry Service",
      // Refresh: POST /api/network-device/{id}/refresh.
      "Edit Network Device",
    ],
  };

// The plans the pages name: the Dashboard shows a plan's name as written.
export const PLAN_NAMES: Readonly<Record<string, ReadonlyArray<string>>> = {
  [INVENTORY_CUSTOM_FIELDS]: ["Growth"],
  [CMDB_SYNC]: ["Growth"],
  [API_REFERENCE]: ["Scale", "Growth"],
};

/*
 * Bold names every language's Dashboard draws in English, so every page
 * keeps them as written:
 *
 *   - the ⋯ menu, a symbol in every language;
 *   - the Owned permission scope, which no locale has as a key;
 *   - the workflow trigger On Update and its Fields to watch setting, which the
 *     workflow builder draws as the component catalog writes them.
 */
export const KEPT_AS_WRITTEN: Readonly<Record<string, ReadonlyArray<string>>> =
  {
    [API_REFERENCE]: ["⋯", "Owned", "On Update", "Fields to watch"],
  };

/*
 * Bold words that are emphasis, not a Dashboard label: a translation words
 * them freely.
 */
export const PROSE: Readonly<Record<string, ReadonlyArray<string>>> = {
  [CMDB_SYNC]: ["replace"],
};

/*
 * Names a translation writes as the English does, in prose and tables too:
 * products, systems, protocols and the MIB objects a network device
 * reports. A line made of them alone is not a line left untranslated.
 */
export const PRODUCT_NAMES: ReadonlyArray<string> = [
  "OneUptime Cloud",
  "OneUptime",
  "OpenTelemetry",
  "Kubernetes",
  "Proxmox",
  "VMware",
  "vCenters",
  "Ceph",
  "Docker Swarm",
  "Docker",
  "Podman",
  "PostgreSQL",
  "Snowflake",
  "Terraform",
  "Slack",
  "Microsoft Teams",
  "Cisco Meraki MX",
  "Meraki MX",
  "Cisco IOS",
  "Junos OS",
  "Arista EOS",
  "Linux",
  "Windows",
  "Ubiquiti",
  "Net-SNMP",
  "Sitting on the Dock of the Bay",
  "ENTITY-MIB",
  "SNMP",
  "NetBIOS",
  "WMI",
  "DMI",
  "BIOS",
  "UEFI",
  "CMDB",
  "REST",
  "JSON",
  "CSV",
  "HTTP",
  "API",
  "SCIM",
  "MCP",
  "UUID",
  "ISO-8601",
  "UTC",
  "PCI",
  "Markdown",
  "Network Site",
  "Network Device",
];

/*
 * The facts of an Asset Details card, in the card's order, as its labels
 * name them (INVENTORY_ASSET_FIELD_LABELS). The CMDB page's Asset Details
 * table lists them in its first column, in every language as that
 * language's card draws them.
 */
export const ASSET_DETAILS_HEADING: string = "## Asset Details";

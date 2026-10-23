type CronHandler = () => Promise<void>;

interface MockCapturedJob {
  schedule: string;
  run: CronHandler;
}

/*
 * The Workers jobs register themselves through RunCron when they are
 * imported, and export nothing: the Cron util is replaced by a recorder, so
 * a test reads each job's schedule and runs its handler, as the jobs' own
 * suites (App/Tests/Workers/Jobs/TelemetryEntity/) do.
 */
const mockCapturedJobs: Record<string, MockCapturedJob> = {};

jest.mock("../../../FeatureSet/Workers/Utils/Cron", () => {
  return {
    __esModule: true,
    default: jest.fn(
      (
        jobName: string,
        options: { schedule: string },
        runFunction: CronHandler,
      ): void => {
        mockCapturedJobs[jobName] = {
          schedule: options.schedule,
          run: runFunction,
        };
      },
    ),
  };
});

jest.mock("Common/Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Services/InventoryItemService", () => {
  return {
    __esModule: true,
    default: {
      hardDeleteBy: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Services/InventoryItemRelationshipService", () => {
  return {
    __esModule: true,
    default: {
      hardDeleteBy: jest.fn(),
    },
  };
});

import {
  CMDB_SYNC,
  INVENTORY_CUSTOM_FIELDS,
  INVENTORY_OVERVIEW,
} from "./InventoryAndApiDocsPages";
import {
  bold,
  boldIn,
  codeIn,
  englishPage,
  englishSection,
  leadOf,
  lineStartingWith,
  listOf,
  readRepoFile,
  rowStartingWith,
  sourceFilesUnder,
  tableWithHeader,
} from "./InventoryAndApiDocsSupport";
import { escapeRegExp } from "./DocsTranslationChecks";
import { INVENTORY_ASSET_FIELD_LABELS } from "../../../FeatureSet/Dashboard/src/Components/Inventory/InventoryAssetLabels";
import {
  INVENTORY_SOURCE_ORDER,
  getInventorySourceDescriptor,
  getInventorySourceLabel,
  isDeletePermanentForSource,
  sourceHasLivenessSignal,
} from "../../../FeatureSet/Dashboard/src/Components/Inventory/InventorySource";
import { getInventoryTypeLabel } from "../../../FeatureSet/Dashboard/src/Components/Inventory/InventoryTypeCatalog";
import {
  CUSTOM_FIELD_TYPE_LABELS,
  getCustomFieldTypeOptions,
} from "../../../FeatureSet/Dashboard/src/Components/CustomFields/CustomFieldSettingsCopy";
import { getCustomFieldFacetOperators } from "../../../FeatureSet/Dashboard/src/Components/CustomFields/CustomFieldFacets";
import {
  FILTER_OPERATOR_LABELS,
  FilterOperator,
} from "../../../FeatureSet/Dashboard/src/Components/ResourceOwners/FilterChipDropdownTypes";
import CloudResource from "Common/Models/DatabaseModels/CloudResource";
import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import DockerHost from "Common/Models/DatabaseModels/DockerHost";
import InventoryItem from "Common/Models/DatabaseModels/InventoryItem";
import InventoryItemCustomField from "Common/Models/DatabaseModels/InventoryItemCustomField";
import IoTDevice from "Common/Models/DatabaseModels/IoTDevice";
import NetworkDevice from "Common/Models/DatabaseModels/NetworkDevice";
import PodmanHost from "Common/Models/DatabaseModels/PodmanHost";
import RumApplication from "Common/Models/DatabaseModels/RumApplication";
import ServerlessFunction from "Common/Models/DatabaseModels/ServerlessFunction";
import {
  INVENTORY_SOURCES,
  hasCustomFieldValues,
  partitionOrphanRows,
} from "Common/Server/Utils/Telemetry/InventoryEntityRegistry";
import InventoryItemService from "Common/Server/Services/InventoryItemService";
import InventoryItemRelationshipService from "Common/Server/Services/InventoryItemRelationshipService";
import { PlanType } from "Common/Types/Billing/SubscriptionPlan";
import CustomFieldType from "Common/Types/CustomField/CustomFieldType";
import ExceptionCode from "Common/Types/Exception/ExceptionCode";
import ObjectID from "Common/Types/ObjectID";
import EntityRelationshipType from "Common/Types/Telemetry/EntityRelationshipType";
import EntitySource from "Common/Types/Telemetry/EntitySource";
import EntityType from "Common/Types/Telemetry/EntityType";
import {
  INVENTORY_ENTITY_TYPES,
  MANUAL_ENTITY_TYPES,
} from "Common/Types/Telemetry/EntityTypeGroups";
import {
  INVENTORY_LIVE_WINDOW_MINUTES,
  INVENTORY_STALE_AFTER_MINUTES,
} from "Common/Types/Telemetry/InventoryLiveness";
import { TopologyApiLimits } from "Common/Types/Topology/TopologyApi";
import { startsCollapsed } from "Common/UI/Components/SideMenu/SideMenuSectionState";
import { EVERY_FIFTEEN_MINUTE, EVERY_THREE_HOURS } from "Common/Utils/CronTime";
import { INVENTORY_ASSET_FIELDS } from "Common/Utils/Inventory/InventoryAssetDetails";
import {
  getNetworkDeviceAssetFacts,
  getNetworkDeviceDnsName,
  getNetworkDeviceHostname,
  getNetworkDeviceIpAddress,
  getNetworkDeviceLocation,
  getNetworkDeviceManufacturer,
} from "Common/Utils/NetworkDevice/NetworkDeviceAssetFacts";
import { parseSystemDescription } from "Common/Utils/NetworkDevice/SystemDescriptionUtil";
import { inferRelationshipType } from "Common/Utils/Telemetry/EntityRelationship";
import { beforeAll, describe, expect, it } from "@jest/globals";

// Imported for their side effect: RunCron (recorded above) keeps each handler.
import "../../../FeatureSet/Workers/Jobs/TelemetryEntity/PruneStaleEntities";
import "../../../FeatureSet/Workers/Jobs/TelemetryEntity/SyncInventoryEntities";

/*
 * What the English Inventory pages say about the product, held to the code
 * that makes it true (docs overhaul task 26b).
 *
 * Markdown is not compiled, so nothing else notices when a source is
 * relabelled, a kind of item stops being catalogued, a retention window or
 * a schedule moves, the side menu gains a page or the custom field chips
 * offer other comparisons while the pages keep the old words. Each test
 * reads the source of truth - the source and type catalogues, the Workers
 * jobs run with their database calls recorded, the relationship rules, the
 * models' plans and permissions, the filter chips' operators, or a
 * Dashboard page read as text (an App test does not render a React page) -
 * and checks the page still says what it does.
 *
 * ApiReferenceDocsFacts holds the CMDB page's requests and the API reference
 * to the API; InventoryAndApiDocsTranslations holds the sixteen other
 * languages to these pages; InventoryAssetDetailsWiring,
 * InventoryMacFirmwareWiring and HostAssetAttributesWiring hold the asset
 * tables of the CMDB page to the asset vocabulary.
 */

const DASHBOARD_APP: string = "App/FeatureSet/Dashboard/src";
const INVENTORY_MENU: string = `${DASHBOARD_APP}/Pages/Inventory/SideMenu.tsx`;
const ITEM_MENU: string = `${DASHBOARD_APP}/Pages/Inventory/View/SideMenu.tsx`;
const ITEM_SETTINGS: string = `${DASHBOARD_APP}/Pages/Inventory/View/Settings.tsx`;
const INVENTORY_TABLE: string = `${DASHBOARD_APP}/Components/Inventory/InventoryTable.tsx`;
const CONNECTIONS: string = `${DASHBOARD_APP}/Components/Inventory/InventoryRelationships.tsx`;
const LINKED_RESOURCE: string = `${DASHBOARD_APP}/Components/Inventory/LinkedResource.ts`;
const SETTINGS_POLICY: string = `${DASHBOARD_APP}/Components/Inventory/InventorySettingsPolicy.ts`;
const ARCHIVE_CARD: string = `${DASHBOARD_APP}/Components/TelemetryResource/ArchiveResourceCard.tsx`;
const CUSTOM_FIELDS_PAGE_BASE: string = `${DASHBOARD_APP}/Pages/Settings/Base/CustomFieldsPageBase.tsx`;
const CUSTOM_FIELD_OPTIONS: string = `${DASHBOARD_APP}/Components/CustomFields/CustomFieldOptionsField.tsx`;
const COLOR_PICKER: string =
  "Common/UI/Components/Forms/Fields/ColorPicker.tsx";
const OPTIONS_EDITOR: string =
  "Common/UI/Components/CustomFields/DropdownOptionsInput.tsx";
const CUSTOM_FIELD_COLUMNS: string =
  "Common/UI/Components/ModelTable/CustomFieldColumns.tsx";
const ENTITY_REGISTRY: string =
  "Common/Server/Utils/Telemetry/EntityRegistry.ts";
const CUSTOM_FIELD_VALUE_STORES: string =
  "Common/Server/Utils/CustomField/CustomFieldValueStores.ts";
const CUSTOM_FIELD_RENAME: string =
  "Common/Server/Utils/CustomField/CustomFieldRename.ts";
const SERVER_DIR: string = "Common/Server";

const PRUNE_JOB: string = "TelemetryEntity:PruneStaleEntities";
const SYNC_JOB: string = "TelemetryEntity:SyncInventoryEntities";

const HOUR_IN_MS: number = 60 * 60 * 1000;
const DAY_IN_HOURS: number = 24;

// A side menu's titles, as the menu files write them, one per line.
const MENU_TITLE_LINE: RegExp = /^(\s*)title: "([^"]+)",$/;
// What is left of a row of kinds once every kind is taken out: separators.
const LIST_SEPARATORS: RegExp = /(\s|,|\||\band\b)+/g;
// "1 day", "7 days": a retention window as the overview's table states it.
const DAYS_CELL: RegExp = /^(\d+) days?$/;
// "the last 30 minutes": a liveness window as the overview states it.
const MINUTES_PHRASE: RegExp = /(\d+) minutes/;
// A member of a TypeScript set or array of entity types, as source text.
const ENTITY_TYPE_MEMBER: RegExp = /EntityType\.(\w+)/g;
// What getSourceTitle answers, in the Inventory side menu's own file.
const SOURCE_TITLE_RETURN: RegExp = /return "([^"]+)";/g;
// A Connections section as the component lists it.
const CONNECTIONS_SECTION: RegExp = /\{ section: "\w+", title: "([^"]+)" \}/g;
// A linked resource kind, by the entity type it is read from.
const LINKED_RESOURCE_ENTRY: RegExp =
  /\[EntityType\.(\w+)\]: LinkedResourceKind\.\w+/g;
// A string constant of a source file: `export const NAME: string = "Value";`.
const STRING_CONSTANT: (name: string) => RegExp = (name: string): RegExp => {
  return new RegExp(`${escapeRegExp(name)}: string = "([^"]+)"`);
};

interface MenuSection {
  title: string;
  items: Array<string>;
  defaultCollapsed: boolean | undefined;
}

interface DeleteCall {
  query: {
    entityType?: EntityType;
    source?: EntitySource;
    lastSeenAt?: { objectLiteralParameters?: Record<string, unknown> };
    isArchived?: unknown;
  };
}

/*
 * A side menu's sections and their links, read from the menu file's
 * `sections` array, and only from it: each section's title is indented
 * less than its links' titles. A section the file builds from a list
 * (By Source) has no literal links.
 */
function menuSections(relativePath: string): Array<MenuSection> {
  const file: string = readRepoFile(relativePath);
  const sectionsStart: number = file.indexOf("const sections");

  if (sectionsStart < 0) {
    throw new Error(`${relativePath} declares no "const sections"`);
  }

  const sectionsEnd: number = file.indexOf("\n  ];", sectionsStart);

  if (sectionsEnd < 0) {
    throw new Error(`${relativePath} never closes its sections array`);
  }

  const source: string = file.slice(sectionsStart, sectionsEnd);
  const titles: Array<{ indent: number; title: string; at: number }> = [];
  let offset: number = 0;

  for (const line of source.split("\n")) {
    const match: RegExpMatchArray | null = line.match(MENU_TITLE_LINE);

    if (match) {
      titles.push({
        indent: (match[1] as string).length,
        title: match[2] as string,
        at: offset,
      });
    }

    offset += line.length + 1;
  }

  if (titles.length === 0) {
    throw new Error(`${relativePath}'s sections array has no titles`);
  }

  const sectionIndent: number = Math.min(
    ...titles.map((title: { indent: number }): number => {
      return title.indent;
    }),
  );
  const sections: Array<MenuSection> = [];

  titles.forEach(
    (
      title: { indent: number; title: string; at: number },
      index: number,
    ): void => {
      if (title.indent === sectionIndent) {
        const next: { at: number } | undefined = titles
          .slice(index + 1)
          .find((candidate: { indent: number }): boolean => {
            return candidate.indent === sectionIndent;
          });
        const body: string = source.slice(
          title.at,
          next ? next.at : source.length,
        );
        const explicit: boolean | undefined = body.includes(
          "defaultCollapsed: true",
        )
          ? true
          : body.includes("defaultCollapsed: false")
            ? false
            : undefined;

        sections.push({
          title: title.title,
          items: [],
          defaultCollapsed: explicit,
        });
        return;
      }

      sections[sections.length - 1]?.items.push(title.title);
    },
  );

  return sections;
}

function collapsedSectionTitles(sections: Array<MenuSection>): Array<string> {
  return sections
    .filter((section: MenuSection): boolean => {
      return startsCollapsed({
        title: section.title,
        defaultCollapsed: section.defaultCollapsed,
      });
    })
    .map((section: MenuSection): string => {
      return section.title;
    });
}

/*
 * The members of a `new Set<EntityType>([...])` or a Map's keys declared
 * under `name` in a source file, as entity types.
 */
function entityTypesDeclaredAs(source: string, name: string): Set<EntityType> {
  const start: number = source.indexOf(name);

  if (start < 0) {
    throw new Error(`Nothing is declared as "${name}"`);
  }

  const end: number = source.indexOf("]);", start);

  if (end < 0) {
    throw new Error(`"${name}" is not a list of entity types`);
  }

  const declaration: string = source.slice(start, end);

  return new Set<EntityType>(
    Array.from(declaration.matchAll(ENTITY_TYPE_MEMBER)).map(
      (match: RegExpMatchArray): EntityType => {
        return EntityType[match[1] as keyof typeof EntityType];
      },
    ),
  );
}

// The entity types that become Inventory items when telemetry names them.
function catalogedFromTelemetry(): Array<EntityType> {
  const membershipOnly: Set<EntityType> = membershipOnlyTypes();

  return Object.values(EntityType).filter((type: EntityType): boolean => {
    return (
      !membershipOnly.has(type) &&
      !INVENTORY_ENTITY_TYPES.has(type) &&
      !MANUAL_ENTITY_TYPES.has(type)
    );
  });
}

function membershipOnlyTypes(): Set<EntityType> {
  return entityTypesDeclaredAs(
    readRepoFile(ENTITY_REGISTRY),
    "const MEMBERSHIP_ONLY_TYPES",
  );
}

// The overview's sources table: a row per source, in the list's order.
function sourcesTable(): Array<Array<string>> {
  return tableWithHeader(
    englishSection(INVENTORY_OVERVIEW, "## How items get into Inventory"),
    "Source",
  );
}

// The overview's row for a source, by the label the Source column gives it.
function sourceRow(source: EntitySource): Array<string> {
  return rowStartingWith(sourcesTable(), bold(getInventorySourceLabel(source)));
}

/*
 * The record each mirrored kind is copied from, as the overview's Mirrored
 * row names it (by the record's plural name: "RUM applications", which the
 * Inventory list types as a browser application).
 */
const MIRRORED_RECORDS: ReadonlyMap<EntityType, { new (): BaseModel }> =
  new Map<EntityType, { new (): BaseModel }>([
    [EntityType.NetworkDevice, NetworkDevice],
    [EntityType.CloudResource, CloudResource],
    [EntityType.IoTDevice, IoTDevice],
    [EntityType.ServerlessFunction, ServerlessFunction],
    [EntityType.RumApplication, RumApplication],
    [EntityType.DockerHost, DockerHost],
    [EntityType.PodmanHost, PodmanHost],
  ]);

const pruneDeletes: Array<DeleteCall> = [];
const relationshipDeletes: Array<DeleteCall> = [];
let pruneRanAt: number = 0;

beforeAll(async () => {
  const entityMock: { hardDeleteBy: jest.Mock } =
    InventoryItemService as unknown as { hardDeleteBy: jest.Mock };
  const relationshipMock: { hardDeleteBy: jest.Mock } =
    InventoryItemRelationshipService as unknown as {
      hardDeleteBy: jest.Mock;
    };

  // Zero rows deleted ends each batching loop after one pass.
  entityMock.hardDeleteBy.mockResolvedValue(0);
  relationshipMock.hardDeleteBy.mockResolvedValue(0);

  pruneRanAt = Date.now();
  await (mockCapturedJobs[PRUNE_JOB] as MockCapturedJob).run();

  for (const call of entityMock.hardDeleteBy.mock.calls) {
    pruneDeletes.push(call[0] as DeleteCall);
  }

  for (const call of relationshipMock.hardDeleteBy.mock.calls) {
    relationshipDeletes.push(call[0] as DeleteCall);
  }
});

// How long a delete waits, in whole hours: the prune's cutoff, from the run.
function hoursBefore(call: DeleteCall): number {
  const cutoff: Date = Object.values(
    call.query.lastSeenAt?.objectLiteralParameters || {},
  )[0] as Date;

  return Math.round((pruneRanAt - cutoff.getTime()) / HOUR_IN_MS);
}

// The retention window of each type the prune sweeps, in hours.
function pruneWindows(): Map<EntityType, number> {
  return new Map<EntityType, number>(
    pruneDeletes.map((call: DeleteCall): [EntityType, number] => {
      return [call.query.entityType as EntityType, hoursBefore(call)];
    }),
  );
}

/*
 * The words the overview's retention table uses for each kind of item, by
 * entity type. A kind is named once, in the row of its window.
 */
const RETENTION_WORDS: ReadonlyArray<[string, ReadonlyArray<EntityType>]> = [
  ["Pods", [EntityType.KubernetesPod]],
  ["deployments", [EntityType.KubernetesDeployment]],
  ["Proxmox guests", [EntityType.ProxmoxGuest]],
  ["VMware virtual machines", [EntityType.VMwareVirtualMachine]],
  [
    "Kubernetes nodes and namespaces",
    [EntityType.KubernetesNode, EntityType.KubernetesNamespace],
  ],
  ["Proxmox nodes", [EntityType.ProxmoxNode]],
  [
    "VMware hosts, clusters and datastores",
    [
      EntityType.VMwareHost,
      EntityType.VMwareCluster,
      EntityType.VMwareDatastore,
    ],
  ],
  [
    "the databases and remote services your traces call",
    [EntityType.Database, EntityType.RemoteService],
  ],
  ["Services", [EntityType.Service]],
  ["hosts", [EntityType.Host]],
  [
    "Kubernetes, Proxmox and Ceph clusters",
    [
      EntityType.KubernetesCluster,
      EntityType.ProxmoxCluster,
      EntityType.CephCluster,
    ],
  ],
  ["storage arrays", [EntityType.StorageArray]],
  ["vCenters", [EntityType.VMwareVCenter]],
  ["Docker Swarm clusters", [EntityType.DockerSwarmCluster]],
];

describe("Inventory Overview: where items come from", () => {
  const overview: string = englishPage(INVENTORY_OVERVIEW);

  it("names the three sources in the list's order, as the Source column labels them, with their API values", () => {
    expect(
      sourcesTable().map((row: Array<string>): Array<string> => {
        return [row[0] as string, row[1] as string];
      }),
    ).toEqual(
      INVENTORY_SOURCE_ORDER.map((source: EntitySource): Array<string> => {
        return [bold(getInventorySourceLabel(source)), `\`${source}\``];
      }),
    );
  });

  it("lists every kind OneUptime mirrors, by the record it is copied from, on the mirror's fifteen-minute schedule", () => {
    const mirrored: string = sourceRow(EntitySource.Inventory)[2] as string;

    // The mirror's sources are the mirrored types, and each has its record.
    expect(
      INVENTORY_SOURCES.map((source: { entityType: EntityType }): string => {
        return source.entityType;
      }).sort(),
    ).toEqual([...INVENTORY_ENTITY_TYPES].sort());
    expect([...MIRRORED_RECORDS.keys()].sort()).toEqual(
      [...INVENTORY_ENTITY_TYPES].sort(),
    );

    for (const [type, record] of MIRRORED_RECORDS) {
      const plural: string = (new record().pluralName as string).toLowerCase();

      expect({ type, named: mirrored.toLowerCase().includes(plural) }).toEqual({
        type,
        named: true,
      });
    }

    expect(mirrored).toContain("Copied every 15 minutes.");
    expect(overview).toContain('-->|"Mirrored every<br/>15 minutes"|');
    expect((mockCapturedJobs[SYNC_JOB] as MockCapturedJob).schedule).toBe(
      EVERY_FIFTEEN_MINUTE,
    );
    expect(EVERY_FIFTEEN_MINUTE).toBe("*/15 * * * *");
  });

  it("names only kinds that become items: never the membership-only ones", () => {
    const lead: string = leadOf(overview);
    const discovered: string = sourceRow(EntitySource.Discovered)[2] as string;
    const membershipOnly: Set<EntityType> = membershipOnlyTypes();

    // The membership-only kinds the page used to name.
    for (const type of [
      EntityType.Container,
      EntityType.Process,
      EntityType.ServiceInstance,
      EntityType.TelemetrySdk,
    ]) {
      expect({ type, membershipOnly: membershipOnly.has(type) }).toEqual({
        type,
        membershipOnly: true,
      });
    }

    for (const text of [lead, discovered]) {
      for (const word of ["container", "process", "service instance", "SDK"]) {
        expect({ text, word, named: text.includes(word) }).toEqual({
          text,
          word,
          named: false,
        });
      }
    }

    // What the lead and the Discovered row do name is catalogued.
    const cataloged: Array<EntityType> = catalogedFromTelemetry();

    for (const type of [
      EntityType.Service,
      EntityType.Host,
      EntityType.KubernetesPod,
      EntityType.VMwareVirtualMachine,
      EntityType.ProxmoxGuest,
    ]) {
      expect(cataloged).toContain(type);
    }

    expect(lead).toContain(
      "services, hosts, Kubernetes objects, virtual machines, network devices, cloud resources, IoT devices, serverless functions",
    );
    expect(discovered).toContain(
      "a service, host, Kubernetes object or virtual machine that sends telemetry.",
    );
  });

  it("says a discovered or mirrored item cannot be renamed or retyped, and that its Settings page says where to change it", () => {
    const policy: string = readRepoFile(SETTINGS_POLICY);

    expect(overview).toContain(
      "A discovered or mirrored item cannot be renamed or given another type: its source would overwrite the change on its next pass. The item's **Settings** page says where to make a lasting change instead.",
    );
    expect(policy).toContain("This item was discovered from telemetry.");
    expect(policy).toContain(
      "This item is mirrored from another OneUptime resource.",
    );
    expect(
      new InventoryItem().getColumnAccessControlFor("entityType")?.update,
    ).toEqual([]);
    expect(
      new InventoryItem().getColumnAccessControlFor("source")?.update,
    ).toEqual([]);
  });

  it("gives a heartbeat to discovered items only, with the Status column's windows", () => {
    const statusRows: Array<Array<string>> = tableWithHeader(
      englishSection(INVENTORY_OVERVIEW, "### How long a silent item stays"),
      "Status",
    );

    expect(
      INVENTORY_SOURCE_ORDER.map((source: EntitySource): boolean => {
        return sourceHasLivenessSignal(source);
      }),
    ).toEqual([true, false, false]);
    expect(overview).toContain(
      "Mirrored items and the ones you added have no heartbeat, so their status stays blank rather than alarming.",
    );
    expect(
      statusRows.map((row: Array<string>): string => {
        return row[0] as string;
      }),
    ).toEqual([bold("Live"), bold("Recent"), bold("Stale")]);

    const live: RegExpMatchArray | null = (
      rowStartingWith(statusRows, bold("Live"))[1] as string
    ).match(MINUTES_PHRASE);

    expect(Number(live?.[1])).toBe(INVENTORY_LIVE_WINDOW_MINUTES);
    expect(INVENTORY_STALE_AFTER_MINUTES).toBe(DAY_IN_HOURS * 60);
    expect(rowStartingWith(statusRows, bold("Recent"))[1]).toBe(
      "Seen within the last day.",
    );
    expect(rowStartingWith(statusRows, bold("Stale"))[1]).toContain(
      "Not seen for more than a day. The **Gone Quiet** page lists these.",
    );
  });
});

describe("Inventory Overview: how long a silent item stays", () => {
  function silentItems(): string {
    return englishSection(
      INVENTORY_OVERVIEW,
      "### How long a silent item stays",
    );
  }

  it("removes discovered items every three hours, archived ones and their custom field values included", () => {
    expect((mockCapturedJobs[PRUNE_JOB] as MockCapturedJob).schedule).toBe(
      EVERY_THREE_HOURS,
    );
    expect(EVERY_THREE_HOURS).toBe("0 */3 * * *");
    expect(pruneDeletes.length).toBeGreaterThan(0);

    for (const call of pruneDeletes) {
      expect(call.query.source).toBe(EntitySource.Discovered);
      // No archive filter: an archived discovered item goes the same way.
      expect(Object.keys(call.query).includes("isArchived")).toBe(false);
    }

    expect(silentItems()).toContain(
      "Every three hours, OneUptime removes the discovered items that have been silent for longer than their kind's window, archived ones included, and their custom field values go with them. Mirrored items and the ones you added are never removed this way.",
    );
  });

  it("states each kind's window as the prune uses it, naming every catalogued kind it sweeps and none it never catalogues", () => {
    const windows: Map<EntityType, number> = pruneWindows();
    const rows: Array<Array<string>> = tableWithHeader(
      silentItems(),
      "Kind of item",
    );
    const cataloged: Array<EntityType> = catalogedFromTelemetry();
    const named: Array<EntityType> = [];

    for (const row of rows) {
      const days: RegExpMatchArray | null = (row[1] as string).match(DAYS_CELL);

      expect({ row: row[1], days: Boolean(days) }).toEqual({
        row: row[1],
        days: true,
      });

      const hours: number = Number(days![1]) * DAY_IN_HOURS;
      let kinds: string = row[0] as string;

      // Longest first: "VMware hosts" is taken out before "hosts" is looked for.
      for (const [words, types] of [...RETENTION_WORDS].sort(
        (
          a: [string, ReadonlyArray<EntityType>],
          b: [string, ReadonlyArray<EntityType>],
        ): number => {
          return b[0].length - a[0].length;
        },
      )) {
        if (!kinds.includes(words)) {
          continue;
        }

        kinds = kinds.split(words).join("|");

        for (const type of types) {
          expect({ type, hours: windows.get(type) }).toEqual({ type, hours });
          named.push(type);
        }
      }

      // Nothing on the row is a kind the test does not know.
      expect({ row: row[0], rest: kinds.replace(LIST_SEPARATORS, "") }).toEqual(
        { row: row[0], rest: "" },
      );
    }

    // Every kind the prune sweeps that becomes an item is in the table.
    const swept: Array<EntityType> = Array.from(windows.keys()).filter(
      (type: EntityType): boolean => {
        return cataloged.includes(type);
      },
    );

    expect([...named].sort()).toEqual([...swept].sort());
  });

  it("removes a discovered relationship after thirty days unseen", () => {
    expect(relationshipDeletes.length).toBeGreaterThan(0);

    for (const call of relationshipDeletes) {
      expect(call.query.source).toBe(EntitySource.Discovered);
      expect(hoursBefore(call)).toBe(30 * DAY_IN_HOURS);
    }

    expect(silentItems()).toContain(
      "A relationship OneUptime discovered is removed once it has not been seen again for 30 days.",
    );
  });
});

describe("Inventory Overview: finding your way around", () => {
  function findYourWay(): string {
    return englishSection(INVENTORY_OVERVIEW, "## Find your way around");
  }

  it("opens Inventory from the Products menu's Resources group", () => {
    const section: string = findYourWay();
    const navigation: string = readRepoFile(
      `${DASHBOARD_APP}/Utils/NavigationItems.tsx`,
    );
    const entry: string = navigation.slice(
      navigation.indexOf('t("navbar.items.inventoryTitle"'),
    );

    expect(entry.slice(0, entry.indexOf("},\n    {"))).toContain(
      "category: resourcesCategory",
    );
    expect(section).toContain("Open **Products → Resources → Inventory**.");
  });

  it("names the folded sections as the menu folds them", () => {
    const section: string = findYourWay();
    const folded: Array<string> = collapsedSectionTitles(
      menuSections(INVENTORY_MENU),
    );

    expect(folded).toEqual(["By Source", "Settings", "Help", "Advanced"]);
    expect(section).toContain(
      `${listOf(folded.map(bold), "and")} start folded: click a section's title to open it.`,
    );
  });

  it("lists every page of the menu, in the menu's order, under its section", () => {
    const pages: Array<string> = tableWithHeader(findYourWay(), "Page").map(
      (row: Array<string>): string => {
        return row[0] as string;
      },
    );
    const expected: Array<string> = menuSections(INVENTORY_MENU).flatMap(
      (entry: MenuSection): Array<string> => {
        if (entry.title === "Inventory") {
          return entry.items.map(bold);
        }

        if (entry.items.length === 0) {
          return [bold(entry.title)];
        }

        return entry.items.map((item: string): string => {
          return bold(`${entry.title} → ${item}`);
        });
      },
    );

    expect(pages).toEqual(expected);
  });

  it("names the By Source pages as the menu titles them, and Gone Quiet as the discovered items' stale list", () => {
    const section: string = findYourWay();
    const source: string = readRepoFile(INVENTORY_MENU);
    const getSourceTitle: string = source.slice(
      source.indexOf("const getSourceTitle"),
      source.indexOf("type ScopedItemsRouteFunction"),
    );
    const titles: Array<string> = Array.from(
      getSourceTitle.matchAll(SOURCE_TITLE_RETURN),
    ).map((match: RegExpMatchArray): string => {
      return match[1] as string;
    });

    expect(titles).toEqual(["Discovered", "Mirrored", "Added by You"]);
    expect(section).toContain(
      `| **By Source** | The items of one source: ${listOf(titles.map(bold), "or")}. |`,
    );

    const goneQuiet: string = source.slice(
      source.indexOf('title: "Gone Quiet"'),
      source.indexOf('title: "By Source"'),
    );

    expect(goneQuiet).toContain("source: EntitySource.Discovered");
    expect(goneQuiet).toContain("staleOnly: true");
    expect(section).toContain(
      "| **Gone Quiet** | The discovered items that have not sent telemetry for more than a day. |",
    );
  });

  it("lists an item's own pages in its side menu's order", () => {
    const itemMenu: Array<MenuSection> = menuSections(ITEM_MENU);
    const line: string = lineStartingWith(
      findYourWay(),
      "Open an item, and its own side menu",
    );
    const expected: Array<string> = itemMenu.flatMap(
      (entry: MenuSection): Array<string> => {
        return entry.title === "Advanced"
          ? [entry.title, ...entry.items]
          : entry.items;
      },
    );

    expect(boldIn(line)).toEqual(expected);
  });

  it("shows the incidents, alerts and maintenance of a service, host or Kubernetes cluster only", () => {
    const linked: Array<string> = Array.from(
      readRepoFile(LINKED_RESOURCE).matchAll(LINKED_RESOURCE_ENTRY),
    ).map((match: RegExpMatchArray): string => {
      return match[1] as string;
    });

    expect(linked).toEqual(["Service", "Host", "KubernetesCluster"]);
    expect(findYourWay()).toContain(
      "The incidents, alerts and maintenance events are those of the service, host or Kubernetes cluster the item stands for; on any other item, those pages say which resource to look at instead.",
    );
  });

  it("lists the Asset Details card's facts in the card's order", () => {
    const facts: string = listOf(
      INVENTORY_ASSET_FIELDS.map((field: string): string => {
        return INVENTORY_ASSET_FIELD_LABELS[
          field as keyof typeof INVENTORY_ASSET_FIELD_LABELS
        ];
      }),
      "and",
    );

    expect(findYourWay().toLowerCase()).toContain(
      `that describes both the same way: ${facts.toLowerCase()}.`,
    );
  });

  it("groups an item's connections as the Connections page does, capped where the server stops counting", () => {
    const section: string = findYourWay();
    const groups: Array<string> = Array.from(
      readRepoFile(CONNECTIONS).matchAll(CONNECTIONS_SECTION),
    ).map((match: RegExpMatchArray): string => {
      return match[1] as string;
    });

    expect(groups).toEqual(["Calls", "Called by", "Runs on", "Related"]);
    expect(section).toContain(
      `grouped into ${listOf(groups.map(bold), "and")}.`,
    );
    expect(TopologyApiLimits.EntityConnectionScanLimit).toBe(100_000);
    expect(section).toContain(
      'a group with more than 100,000 connections shows "100,000+"',
    );
    expect(readRepoFile(CONNECTIONS)).toContain('"Show more"');
    expect(section).toContain("**Show more** pages through the rest");
  });
});

describe("Inventory Overview: adding, archiving and relationships", () => {
  it("adds an item with the list's Add Item form: a type, a name and a description", () => {
    const table: string = readRepoFile(INVENTORY_TABLE);
    const steps: string = englishSection(
      INVENTORY_OVERVIEW,
      "## Add something by hand",
    );

    expect(table).toContain('singularName="Item"');
    expect(table).toContain('createVerb="Add"');
    expect(steps).toContain(
      "Click **Add Item**. Pick its **Type**, give it a **Name**, and optionally a **Description**.",
    );

    const form: string = table.slice(
      table.indexOf("formFields={["),
      table.indexOf("filters={["),
    );

    for (const title of ["Type", "Name", "Description"]) {
      expect(form).toContain(`title: "${title}"`);
    }

    expect(form).toContain("Two items of the same type cannot share a name.");
    expect(steps).toContain(
      "The name and the type together are the item's identity, so two items of the same type cannot share a name.",
    );
  });

  it("names the three types a person may add, by value and label, and no other", () => {
    const steps: string = englishSection(
      INVENTORY_OVERVIEW,
      "## Add something by hand",
    );

    expect(steps).toContain("You can add three types by hand:");
    expect(MANUAL_ENTITY_TYPES.size).toBe(3);

    for (const type of MANUAL_ENTITY_TYPES) {
      expect(steps).toContain(
        `- \`${type}\` (**${getInventoryTypeLabel(type)}**): `,
      );
    }
  });

  it("archives rather than deletes: only an item added by hand is gone for good", () => {
    const rows: Array<Array<string>> = tableWithHeader(
      englishSection(INVENTORY_OVERVIEW, "## Archive instead of deleting"),
      "Source",
    );

    expect(
      rows.map((row: Array<string>): Array<string> => {
        return [row[0] as string, row[2] as string];
      }),
    ).toEqual([
      [
        bold(getInventorySourceLabel(EntitySource.Discovered)),
        "Comes back with the next batch of its telemetry.",
      ],
      [
        bold(getInventorySourceLabel(EntitySource.Inventory)),
        "Comes back with the next copy. Delete the original record instead.",
      ],
      [bold(getInventorySourceLabel(EntitySource.Manual)), "Gone for good."],
    ]);
    expect(
      INVENTORY_SOURCE_ORDER.map((source: EntitySource): boolean => {
        return isDeletePermanentForSource(source);
      }),
    ).toEqual([false, false, true]);
    expect(
      getInventorySourceDescriptor(EntitySource.Inventory)?.deleteCaveat,
    ).toContain("Delete the original record to remove it for good");
  });

  it("archives from the list in one go or from the item's Settings page", () => {
    const section: string = englishSection(
      INVENTORY_OVERVIEW,
      "## Archive instead of deleting",
    );
    const table: string = readRepoFile(INVENTORY_TABLE);
    const settings: string = readRepoFile(ITEM_SETTINGS);
    const card: string = readRepoFile(ARCHIVE_CARD);

    expect(table).toContain("archiveBulkActions");
    expect(table).toContain("unarchiveBulkActions");
    expect(settings).toContain("<ArchiveResourceCard<InventoryItem>");
    expect(card).toContain('title: isArchived ? "Unarchive" : "Archive"');
    expect(section).toContain(
      "To archive items, select them in **All Items** and archive them in one go, or open an item and use the **Archive** card on its **Settings** page.",
    );
  });

  it("archives a mirrored item whose record went, instead of deleting it, only when it carries custom field values", () => {
    const section: string = englishSection(
      INVENTORY_OVERVIEW,
      "## Archive instead of deleting",
    );
    const typed: InventoryItem = new InventoryItem();
    const untyped: InventoryItem = new InventoryItem();
    const typedId: ObjectID = ObjectID.generate();
    const untypedId: ObjectID = ObjectID.generate();

    typed.id = typedId;
    typed.resourceId = ObjectID.generate();
    typed.customFields = { "Asset Tag": "IT-004821" };
    untyped.id = untypedId;
    untyped.resourceId = ObjectID.generate();
    untyped.customFields = {};

    expect(hasCustomFieldValues(typed)).toBe(true);
    expect(hasCustomFieldValues(untyped)).toBe(false);
    expect(
      partitionOrphanRows({
        rows: [typed, untyped],
        liveResourceIds: new Set<string>(),
      }),
    ).toEqual({ deletableIds: [untypedId], archivableIds: [typedId] });
    expect(section).toContain(
      "When a mirrored device is removed from its owning record, OneUptime removes its item too, unless the item carries custom field values you entered.",
    );
  });

  it("lists every relationship OneUptime draws between items, and no other, with true examples", () => {
    const section: string = englishSection(
      INVENTORY_OVERVIEW,
      "## Relationships and topology",
    );
    const cataloged: Array<EntityType> = catalogedFromTelemetry();
    const drawn: Set<string> = new Set<string>([
      // Derived from the spans that cross services (ComputeServiceDependencies).
      EntityRelationshipType.DependsOn,
    ]);

    for (const from of cataloged) {
      for (const to of cataloged) {
        const type: EntityRelationshipType | null = inferRelationshipType(
          from,
          to,
        );

        if (type) {
          drawn.add(type);
        }
      }
    }

    const listed: Array<string> = tableWithHeader(section, "Relationship").map(
      (row: Array<string>): string => {
        return codeIn(row[0] as string)[0] as string;
      },
    );

    expect([...listed].sort()).toEqual([...drawn].sort());
    expect(listed).not.toContain(EntityRelationshipType.InstanceOf);

    // Each example is a pair the rules relate that way.
    const examples: ReadonlyArray<
      [string, EntityType, EntityType, EntityRelationshipType]
    > = [
      [
        "A pod runs on a node",
        EntityType.KubernetesPod,
        EntityType.KubernetesNode,
        EntityRelationshipType.RunsOn,
      ],
      [
        "a virtual machine runs on its host",
        EntityType.VMwareVirtualMachine,
        EntityType.VMwareHost,
        EntityRelationshipType.RunsOn,
      ],
      [
        "A pod, node or namespace is a member of a cluster",
        EntityType.KubernetesNamespace,
        EntityType.KubernetesCluster,
        EntityRelationshipType.MemberOf,
      ],
      [
        "A service is hosted on a host",
        EntityType.Service,
        EntityType.Host,
        EntityRelationshipType.HostedOn,
      ],
      [
        "A pod is part of its deployment",
        EntityType.KubernetesPod,
        EntityType.KubernetesDeployment,
        EntityRelationshipType.PartOf,
      ],
    ];

    for (const [words, from, to, type] of examples) {
      expect(section).toContain(words);
      expect({ words, type: inferRelationshipType(from, to) }).toEqual({
        words,
        type,
      });
    }
  });
});

describe("Inventory Custom Fields", () => {
  const page: string = englishPage(INVENTORY_CUSTOM_FIELDS);

  it("sells custom fields on Growth, and answers 402 below it", () => {
    const model: InventoryItemCustomField = new InventoryItemCustomField();

    for (const plan of [
      model.createBillingPlan,
      model.readBillingPlan,
      model.updateBillingPlan,
      model.deleteBillingPlan,
    ]) {
      expect(plan).toBe(PlanType.Growth);
    }

    expect(ExceptionCode.PaymentRequiredException).toBe(402);
    expect(page).toContain(
      "On OneUptime Cloud, custom fields are part of the **Growth** plan and above. Below it, fields cannot be defined, listed or changed: the API answers `402 Payment Required`",
    );
  });

  it("opens the custom fields page from the Inventory menu's Settings section", () => {
    const settings: MenuSection | undefined = menuSections(INVENTORY_MENU).find(
      (section: MenuSection): boolean => {
        return section.title === "Settings";
      },
    );

    expect(settings?.items).toEqual(["Custom Fields"]);
    expect(page).toContain(
      "Go to **Products → Resources → Inventory**, open **Settings** in the side menu, then **Custom Fields**.",
    );
  });

  it("creates a field with the table's create button and the form's three fields", () => {
    const base: string = readRepoFile(CUSTOM_FIELDS_PAGE_BASE);

    expect(new InventoryItemCustomField().singularName).toBe(
      "Inventory Item Custom Field",
    );
    expect(page).toContain(
      "Click **Create Inventory Item Custom Field**. Give it a **Field Name**, an optional **Field Description**, and a **Field Type** from the table below.",
    );

    for (const title of ["Field Name", "Field Description", "Field Type"]) {
      expect(base).toContain(`title: "${title}"`);
    }
  });

  it("lists a dropdown's options with the options field's colours and drag handles", () => {
    const options: string = readRepoFile(CUSTOM_FIELD_OPTIONS);
    const colors: string = readRepoFile(COLOR_PICKER);

    expect(options).toContain('title: "Dropdown Options"');
    expect(colors.match(STRING_CONSTANT("NO_COLOR_LABEL"))?.[1]).toBe(
      "No color",
    );
    expect(colors.match(STRING_CONSTANT("CUSTOM_COLOR_LABEL"))?.[1]).toBe(
      "Custom color",
    );
    expect(page).toContain(
      "add its options under **Dropdown Options**. Each option can carry a colour, used the same way in the table cell and in the filter chip: pick one of the named colours, **No color**, or **Custom color** for an exact colour code.",
    );

    // The options field edits its list with the option editor, dragged by a handle.
    const editor: string = readRepoFile(OPTIONS_EDITOR);

    expect(options).toContain(
      'import DropdownOptionsInput from "Common/UI/Components/CustomFields/DropdownOptionsInput";',
    );
    expect(editor).toContain('import DragHandle from "../Table/DragHandle";');
    expect(editor).toContain("const onDragEnd: OnDragEndFn");
    expect(page).toContain(
      "Drag an option by its handle to change where it is listed.",
    );
  });

  it("lists every field type as the Field Type picker names it, in the picker's order", () => {
    const rows: Array<Array<string>> = tableWithHeader(
      englishSection(INVENTORY_CUSTOM_FIELDS, "## Defining Fields"),
      "Type",
    );

    expect(
      rows.map((row: Array<string>): string => {
        return row[0] as string;
      }),
    ).toEqual(
      getCustomFieldTypeOptions().map((option: { label: string }): string => {
        return bold(option.label);
      }),
    );
  });

  it("offers on each chip the comparisons its field type gets", () => {
    const rows: Array<Array<string>> = tableWithHeader(
      englishSection(INVENTORY_CUSTOM_FIELDS, "## Filter the list"),
      "Field type",
    );
    const typeByLabel: Map<string, CustomFieldType> = new Map<
      string,
      CustomFieldType
    >(
      Object.values(CustomFieldType).map(
        (type: CustomFieldType): [string, CustomFieldType] => {
          return [CUSTOM_FIELD_TYPE_LABELS[type], type];
        },
      ),
    );
    const covered: Array<CustomFieldType> = [];

    for (const row of rows) {
      const comparisons: string = row[1] as string;

      for (const label of boldIn(row[0] as string)) {
        const type: CustomFieldType = typeByLabel.get(label) as CustomFieldType;
        const operators: Array<FilterOperator> = getCustomFieldFacetOperators({
          name: label,
          customFieldType: type,
          // A dropdown with options offers them; without, it is a text chip.
          dropdownOptions: "In Service",
        });

        expect({ label, comparisons }).toEqual({
          label,
          comparisons: operators
            .map((operator: FilterOperator): string => {
              return FILTER_OPERATOR_LABELS[operator];
            })
            .join(", "),
        });
        covered.push(type);
      }
    }

    expect([...covered].sort()).toEqual(
      [...Object.values(CustomFieldType)].sort(),
    );
  });

  it("starts custom field columns hidden and never sorts them", () => {
    const columns: string = readRepoFile(CUSTOM_FIELD_COLUMNS);

    expect(columns).toContain("disableSort: true");
    expect(columns).toContain(
      "const isHidden: boolean = data.isHiddenByDefault !== false;",
    );
    expect(page).toContain(
      "Custom field columns start hidden: turn them on from the column picker. They cannot be sorted",
    );
  });

  it("moves values with a renamed option, but not with a renamed field: only incident custom fields move theirs", () => {
    const stores: string = readRepoFile(CUSTOM_FIELD_VALUE_STORES);
    // Every server source that renames a field's stored values, wherever it is.
    const renamers: Array<string> = sourceFilesUnder(SERVER_DIR).filter(
      (file: string): boolean => {
        return (
          file !== CUSTOM_FIELD_RENAME &&
          readRepoFile(file).includes("renameCustomField(")
        );
      },
    );

    expect(readRepoFile(CUSTOM_FIELD_RENAME)).toContain(
      "export const renameCustomField: (",
    );
    expect(stores).toContain("new InventoryItemCustomField().tableName");
    expect(renamers).toEqual([
      `${SERVER_DIR}/Services/IncidentCustomFieldService.ts`,
    ]);
    expect(page).toContain(
      "Renaming a field does not move the values already stored under the old name. Incident custom fields are the exception",
    );
    expect(page).toContain(
      "Renaming an option moves it on every item that has it",
    );
  });
});

/*
 * Descriptions real devices send, from the parser's own suite
 * (Common/Tests/Utils/NetworkDevice/SystemDescriptionUtil.test.ts).
 */
const CISCO_IOS_DESCRIPTION: string =
  "Cisco IOS Software, C2960 Software (C2960-LANBASEK9-M), Version 15.0(2)SE11, RELEASE SOFTWARE (fc3)";
const JUNOS_DESCRIPTION: string =
  "Juniper Networks, Inc. ex2200-24t-4g Ethernet Switch, kernel JUNOS 12.3R6.6, Build date: 2014-03-13 07:40:03 UTC Copyright (c) 1996-2014 Juniper Networks, Inc.";
const ARISTA_DESCRIPTION: string =
  "Arista Networks EOS version 4.20.1F running on an Arista Networks DCS-7050SX-64";
const LINUX_DESCRIPTION: string =
  "Linux fw01 5.10.0-21-amd64 #1 SMP Debian 5.10.162-1 (2023-01-21) x86_64";
const UNIFI_DESCRIPTION: string = "USW-24-PoE, 6.5.59.14773, Linux 3.6.5";
const ARUBA_DESCRIPTION: string =
  "Aruba JL258A 2930F-8G-PoE+-2SFP+ Switch, revision WC.16.10.0012, ROM WC.16.01.0008 (/ws/swbuildm/rel_xxx)";

describe("Exporting to a CMDB: what a network device's record gives", () => {
  function networkSection(): string {
    return englishSection(CMDB_SYNC, "## Network Device Asset Attributes");
  }

  // The "Where it comes from" cell of the network table's row for a key.
  function sourceOf(key: string): string {
    const row: Array<string> | undefined = tableWithHeader(
      networkSection(),
      "Field",
    ).find((candidate: Array<string>): boolean => {
      return candidate[1] === `\`${key}\``;
    });

    if (!row) {
      throw new Error(`The network device table has no row for ${key}`);
    }

    return row[2] as string;
  }

  it("reads a Meraki MX's make and model from its system description, and guesses nothing from one it does not know", () => {
    expect(parseSystemDescription("Meraki MX85")).toEqual({
      manufacturer: "Cisco Meraki",
      model: "MX85",
    });
    expect(parseSystemDescription("Acme Widget OS 1.2 on a box")).toEqual({});
    expect(networkSection()).toContain(
      "a Cisco Meraki MX reports `Meraki MX85`, which fills in the make and model. A platform whose `sysDescr` has no known shape adds nothing, rather than a guess.",
    );
  });

  it("names the operating systems a system description gives, as the parser names them", () => {
    const systems: Array<string | undefined> = [
      CISCO_IOS_DESCRIPTION,
      JUNOS_DESCRIPTION,
      ARISTA_DESCRIPTION,
      LINUX_DESCRIPTION,
    ].map((description: string): string | undefined => {
      return parseSystemDescription(description).operatingSystem;
    });

    expect(systems).toEqual(["Cisco IOS", "Junos OS", "Arista EOS", "Linux"]);
    expect(englishSection(CMDB_SYNC, "## Asset Details")).toContain(
      `What \`sysDescr\` names: ${systems.join(", ")} |`,
    );
  });

  it("says the Asset Details card takes a device's model, firmware and OS version from ENTITY-MIB, else from its system description", () => {
    const rows: Array<Array<string>> = tableWithHeader(
      englishSection(CMDB_SYNC, "## Asset Details"),
      "Fact",
    );
    // What the card shows of a device that implements no ENTITY-MIB.
    const described: ReturnType<typeof getNetworkDeviceAssetFacts> =
      getNetworkDeviceAssetFacts({ sysDescr: ARUBA_DESCRIPTION });
    // And of one that does: ENTITY-MIB wins.
    const walked: ReturnType<typeof getNetworkDeviceAssetFacts> =
      getNetworkDeviceAssetFacts({
        sysDescr: ARUBA_DESCRIPTION,
        deviceModel: "2930F",
        firmwareVersion: "WC.16.01.0009",
        softwareVersion: "WC.16.11.0001",
      });

    expect([
      described.model,
      described.firmwareVersion,
      described.osVersion,
    ]).toEqual([
      "JL258A 2930F-8G-PoE+-2SFP+",
      "WC.16.01.0008",
      "WC.16.10.0012",
    ]);
    expect([walked.model, walked.firmwareVersion, walked.osVersion]).toEqual([
      "2930F",
      "WC.16.01.0009",
      "WC.16.11.0001",
    ]);

    for (const key of [
      "device.model.name",
      "device.firmware.version",
      "os.version",
    ]) {
      const row: Array<string> | undefined = rows.find(
        (candidate: Array<string>): boolean => {
          return candidate[1] === `\`${key}\``;
        },
      );

      expect({ key, onANetworkDevice: row?.[3] }).toEqual({
        key,
        onANetworkDevice: "ENTITY-MIB, else what `sysDescr` names",
      });
    }
  });

  it("takes firmware from ENTITY-MIB, else from the system description of the platforms that give one", () => {
    expect(parseSystemDescription(UNIFI_DESCRIPTION).firmwareVersion).toBe(
      "6.5.59.14773",
    );
    expect(parseSystemDescription(ARUBA_DESCRIPTION).firmwareVersion).toBe(
      "WC.16.01.0008",
    );
    expect(parseSystemDescription(ARUBA_DESCRIPTION).manufacturer).toBe(
      "Aruba",
    );
    expect(
      parseSystemDescription(CISCO_IOS_DESCRIPTION).firmwareVersion,
    ).toBeUndefined();
    expect(
      getNetworkDeviceAssetFacts({
        firmwareVersion: "1.2.3",
        sysDescr: UNIFI_DESCRIPTION,
      }).firmwareVersion,
    ).toBe("1.2.3");
    expect(sourceOf("device.firmware.version")).toBe(
      "ENTITY-MIB `entPhysicalFirmwareRev`, else the firmware `sysDescr` names on Ubiquiti, HPE and Aruba devices",
    );
  });

  it("never names a device by its IP address, and keeps the address and the DNS name apart", () => {
    expect(
      getNetworkDeviceHostname({ hostname: "10.241.124.1" }),
    ).toBeUndefined();
    expect(
      getNetworkDeviceHostname({
        hostname: "10.241.124.1",
        sysName: "core-sw-01",
      }),
    ).toBe("core-sw-01");
    expect(getNetworkDeviceIpAddress({ hostname: "10.241.124.1" })).toBe(
      "10.241.124.1",
    );
    expect(
      getNetworkDeviceIpAddress({ hostname: "sw1.example.com" }),
    ).toBeUndefined();
    expect(getNetworkDeviceDnsName({ hostname: "sw1.example.com" })).toBe(
      "sw1.example.com",
    );
    expect(sourceOf("host.name")).toContain(
      "Left out when only its IP address names it",
    );
    expect(sourceOf("host.ip")).toBe(
      "The address OneUptime polls, when it is an IP address. For a device polled at a DNS name, the address its probe last resolved that name to",
    );
    expect(networkSection()).toContain(
      "The hostname is never the IP address. A device that only its address names has `host.ip` and no `host.name`.",
    );
  });

  /*
   * Issue #5185: a device polled at a DNS name has the address its probe
   * resolved the name to - and only for that name.
   */
  it("gives a device polled at a DNS name the address its probe resolved, as both tables say", () => {
    const resolved: Record<string, unknown> = {
      ipAddress: {
        value: "10.0.0.1",
        method: "dns",
        readBy: { type: "probe", id: "30000000-0000-4000-8000-000000000001" },
        readAt: "2026-10-23T09:00:00.000Z",
      },
    };

    expect(
      getNetworkDeviceIpAddress({
        hostname: "sw1.example.com",
        discoveredDetails: resolved,
      }),
    ).toBe("10.0.0.1");
    // A device polled at an address keeps that address, whatever is recorded.
    expect(
      getNetworkDeviceIpAddress({
        hostname: "10.241.124.1",
        discoveredDetails: resolved,
      }),
    ).toBe("10.241.124.1");

    const assetRow: Array<string> | undefined = tableWithHeader(
      englishSection(CMDB_SYNC, "## Asset Details"),
      "Fact",
    ).find((candidate: Array<string>): boolean => {
      return candidate[1] === "`host.ip`";
    });
    expect(assetRow?.[3]).toBe(
      "The address OneUptime polls, when it is an IP address, else the address its probe resolved that DNS name to",
    );
  });

  /*
   * Issue #5185: a device that is not walked takes its system group from the
   * discovery scan that last read its address; ENTITY-MIB's rows still need
   * its own walk.
   */
  it("fills a device that is not walked from what a discovery scan read, and only ENTITY-MIB waits for its walk", () => {
    const scan: Record<string, unknown> = {
      type: "discoveryScan",
      id: "80000000-0000-4000-8000-000000000001",
      name: "Store subnets",
    };
    const read: (value: string) => Record<string, unknown> = (
      value: string,
    ): Record<string, unknown> => {
      return {
        value: value,
        method: "snmp",
        readBy: scan,
        readAt: "2026-10-23T07:00:00.000Z",
      };
    };

    const facts: ReturnType<typeof getNetworkDeviceAssetFacts> =
      getNetworkDeviceAssetFacts({
        hostname: "10.20.12.7",
        discoveredDetails: {
          sysName: read("edge-sw-07"),
          sysDescr: read(CISCO_IOS_DESCRIPTION),
          sysObjectId: read("1.3.6.1.4.1.9.1.1208"),
          sysLocation: read("Store 12, back office rack"),
          macAddress: {
            value: "00:1b:54:c2:7a:07",
            method: "arpTable",
            readBy: { type: "networkDevice", id: "router-1" },
            readAt: "2026-10-23T07:00:00.000Z",
          },
        },
      });

    expect({
      hostname: facts.hostname,
      manufacturer: facts.manufacturer,
      operatingSystem: facts.operatingSystem,
      location: facts.location,
      macAddress: facts.macAddress,
      serialNumber: facts.serialNumber,
    }).toEqual({
      hostname: "edge-sw-07",
      manufacturer: "Cisco",
      operatingSystem: "Cisco IOS",
      location: "Store 12, back office rack",
      macAddress: "00-1B-54-C2-7A-07",
      serialNumber: undefined,
    });
    expect(networkSection()).toContain(
      "The ENTITY-MIB rows fill in after the device's first SNMP walk. A device that is not walked, because it is monitored by ping alone or not yet polled, still gets its name, make, operating system and location from what the last discovery scan of its address read over SNMP, and its MAC address from a walked router's ARP table.",
    );
  });

  it("never replaces a saved value with what discovery reads, and of two readings uses the newer", () => {
    const scanLocation: Record<string, unknown> = {
      sysLocation: {
        value: "Hall 3, Rack 2",
        method: "snmp",
        readBy: { type: "discoveryScan", id: "scan-1" },
        readAt: "2026-10-23T09:00:00.000Z",
      },
    };

    // Saved: the device was never walked, so the column is someone's.
    expect(
      getNetworkDeviceLocation({
        sysLocation: "Hall 2, Rack 14",
        discoveredDetails: scanLocation,
      }),
    ).toBe("Hall 2, Rack 14");
    // Two readings: the scan's is newer than the walk's.
    expect(
      getNetworkDeviceLocation({
        sysLocation: "Hall 2, Rack 14",
        lastSnmpSeenAt: "2026-10-23T08:00:00.000Z",
        discoveredDetails: scanLocation,
      }),
    ).toBe("Hall 3, Rack 2");
    // And the walk's is newer than the scan's.
    expect(
      getNetworkDeviceLocation({
        sysLocation: "Hall 2, Rack 14",
        lastSnmpSeenAt: "2026-10-23T10:00:00.000Z",
        discoveredDetails: scanLocation,
      }),
    ).toBe("Hall 2, Rack 14");

    expect(networkSection()).toContain(
      "A value saved on the device, typed or set through the API, is never replaced by what discovery reads. Of a value the device's own walk read and one a scan read, the newer is used.",
    );
    expect(networkSection()).toContain(
      "The item's **Asset Details** card says where each value came from and when.",
    );
  });

  it("takes the make from ENTITY-MIB, else the system description, else the sysObjectID's vendor", () => {
    expect(
      getNetworkDeviceManufacturer({
        vendor: "Juniper Networks",
        sysDescr: "Meraki MX85",
      }),
    ).toBe("Juniper Networks");
    expect(getNetworkDeviceManufacturer({ sysDescr: "Meraki MX85" })).toBe(
      "Cisco Meraki",
    );
    expect(sourceOf("device.manufacturer")).toBe(
      "ENTITY-MIB `entPhysicalMfgName`, else the maker `sysDescr` names, else the vendor of the `sysObjectID`",
    );
  });

  it("leaves out an agent's default location", () => {
    expect(
      getNetworkDeviceLocation({
        sysLocation: "Sitting on the Dock of the Bay",
      }),
    ).toBeUndefined();
    expect(
      getNetworkDeviceLocation({ sysLocation: "Frankfurt DC, Rack B4" }),
    ).toBe("Frankfurt DC, Rack B4");
    expect(sourceOf("device.location")).toBe(
      "`sysLocation`, unless it is an agent's default such as Net-SNMP's \"Sitting on the Dock of the Bay\"",
    );
  });

  it("copies a device's values on the mirror's schedule, replacing the ones before", () => {
    expect((mockCapturedJobs[SYNC_JOB] as MockCapturedJob).schedule).toBe(
      EVERY_FIFTEEN_MINUTE,
    );
    expect(networkSection()).toContain(
      "These values are copied from the Network Device record every fifteen minutes, and they **replace** the previous values rather than adding to them",
    );
  });

  it("archives a mirrored item that carries custom field values when its record goes, and says only that one is", () => {
    const fresh: string = englishSection(CMDB_SYNC, "## Keep it fresh");

    expect(fresh).toContain(
      "A mirrored item that carries custom field values is archived rather than deleted when its record goes",
    );
    expect(fresh).not.toContain("An item that carries custom field values");
  });
});

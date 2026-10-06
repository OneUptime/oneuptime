import {
  CREATE_FROM_RECORD_KINDS,
  CREATE_PAGES,
  CreateFromRecordKind,
  CreateFromRecordKindDefinition,
  CreatedRecordKind,
  RecordTab,
  getCreateFromRecordDefinition,
  getCreateFromRecordField,
  getCreateFromRecordKinds,
} from "../../FeatureSet/Dashboard/src/Components/CreateFromRecord/CreateFromRecord";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * "Please also find similar issues across the project and fix them as well.
 * The idea is to make software as simple as possible to use and reduce
 * decision paralysis." - the maintainer.
 *
 * Creating something from a record's own tab kept nothing of the record: a
 * monitor's Declare Incident, a host's Create Alert, a cluster's Create
 * Scheduled Maintenance Event (where it was offered at all) each opened the
 * project's form with nothing picked. Components/CreateFromRecord is the
 * one way a record travels now, and this guard reads the sources to hold
 * every part of it, so a tab, a table or a create page written later
 * inherits it:
 *
 *   - every record tab that lists incidents, alerts, maintenance events or
 *     announcements is listed below - carrying its record, or creating
 *     nothing, or saying why it carries none;
 *   - each tab the shared module names is the page the router draws for it,
 *     and that page carries the same kind of record;
 *   - the tables put the record into every create button;
 *   - every create page reads it the one way, waits for it, and picks it;
 *   - the create forms offer every resource their own Edit offers, so a
 *     record can be picked at all;
 *   - the trail back through the tab is drawn by the Page the create page
 *     sits in, and a create page starts over when its address changes.
 *
 * Read from source: the pages are React components, which an App test must
 * not import (FeatureSetImportsStayReactFree).
 */

const DASHBOARD_SRC: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
);

// A source with every run of whitespace squashed to one space.
const dense: (relativePath: string) => string = (
  relativePath: string,
): string => {
  return fs
    .readFileSync(path.join(DASHBOARD_SRC, relativePath), "utf8")
    .replace(/\s+/g, " ");
};

// A source with no whitespace at all, for matching what prettier may wrap.
const tight: (relativePath: string) => string = (
  relativePath: string,
): string => {
  return fs
    .readFileSync(path.join(DASHBOARD_SRC, relativePath), "utf8")
    .replace(/\s+/g, "");
};

/*
 * Code as prettier may write it, with neither whitespace nor the trailing
 * commas it adds when it wraps a line: for comparing what a source does.
 */
const canonical: (code: string) => string = (code: string): string => {
  return code.replace(/\s+/g, "").replace(/,(?=[}\])])/g, "");
};

const countOf: (source: string, needle: string) => number = (
  source: string,
  needle: string,
): number => {
  return source.split(needle).length - 1;
};

const listFiles: (directory: string) => Array<string> = (
  directory: string,
): Array<string> => {
  const found: Array<string> = [];

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full: string = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      found.push(...listFiles(full));
      continue;
    }

    if (entry.name.endsWith(".tsx")) {
      found.push(full);
    }
  }

  return found;
};

// The tables that open a create page, by the module that holds each.
const TABLE_MODULES: Record<CreatedRecordKind, string> = {
  [CreatedRecordKind.Incident]: "Components/Incident/IncidentsTable",
  [CreatedRecordKind.Alert]: "Components/Alert/AlertsTable",
  [CreatedRecordKind.ScheduledMaintenance]:
    "Components/ScheduledMaintenance/ScheduledMaintenanceTable",
  [CreatedRecordKind.Announcement]:
    "Components/Announcement/AnnouncementsTable",
};

interface RecordTabShape {
  file: string;
  created: CreatedRecordKind;
  // The kind of record it carries, or how it carries it when not by kind.
  kind: CreateFromRecordKind | "inventory";
}

const kindTabs: (
  folder: string,
  kind: CreateFromRecordKind,
  created: Array<CreatedRecordKind>,
) => Array<RecordTabShape> = (
  folder: string,
  kind: CreateFromRecordKind,
  created: Array<CreatedRecordKind>,
): Array<RecordTabShape> => {
  const files: Record<CreatedRecordKind, string> = {
    [CreatedRecordKind.Incident]: "Incidents.tsx",
    [CreatedRecordKind.Alert]: "Alerts.tsx",
    [CreatedRecordKind.ScheduledMaintenance]: "ScheduledMaintenance.tsx",
    [CreatedRecordKind.Announcement]: "Announcements.tsx",
  };

  return created.map((createdKind: CreatedRecordKind): RecordTabShape => {
    return {
      file: `Pages/${folder}/View/${files[createdKind]}`,
      created: createdKind,
      kind: kind,
    };
  });
};

const INCIDENTS_ALERTS_AND_MAINTENANCE: Array<CreatedRecordKind> = [
  CreatedRecordKind.Incident,
  CreatedRecordKind.Alert,
  CreatedRecordKind.ScheduledMaintenance,
];

// Every record tab that creates, and the record it carries into the form.
const RECORD_TABS: Array<RecordTabShape> = [
  ...kindTabs("Monitor", CreateFromRecordKind.Monitor, [
    CreatedRecordKind.Incident,
    CreatedRecordKind.Alert,
  ]),
  ...kindTabs(
    "Host",
    CreateFromRecordKind.Host,
    INCIDENTS_ALERTS_AND_MAINTENANCE,
  ),
  ...kindTabs(
    "Kubernetes",
    CreateFromRecordKind.KubernetesCluster,
    INCIDENTS_ALERTS_AND_MAINTENANCE,
  ),
  ...kindTabs(
    "Docker",
    CreateFromRecordKind.DockerHost,
    INCIDENTS_ALERTS_AND_MAINTENANCE,
  ),
  ...kindTabs(
    "Podman",
    CreateFromRecordKind.PodmanHost,
    INCIDENTS_ALERTS_AND_MAINTENANCE,
  ),
  ...kindTabs(
    "Proxmox",
    CreateFromRecordKind.ProxmoxCluster,
    INCIDENTS_ALERTS_AND_MAINTENANCE,
  ),
  ...kindTabs(
    "VMware",
    CreateFromRecordKind.VMwareVCenter,
    INCIDENTS_ALERTS_AND_MAINTENANCE,
  ),
  ...kindTabs(
    "Ceph",
    CreateFromRecordKind.CephCluster,
    INCIDENTS_ALERTS_AND_MAINTENANCE,
  ),
  ...kindTabs(
    "StorageArray",
    CreateFromRecordKind.StorageArray,
    INCIDENTS_ALERTS_AND_MAINTENANCE,
  ),
  ...kindTabs(
    "DockerSwarm",
    CreateFromRecordKind.DockerSwarmCluster,
    INCIDENTS_ALERTS_AND_MAINTENANCE,
  ),
  ...kindTabs(
    "IoT",
    CreateFromRecordKind.IoTFleet,
    INCIDENTS_ALERTS_AND_MAINTENANCE,
  ),
  ...kindTabs(
    "Database",
    CreateFromRecordKind.DatabaseServer,
    INCIDENTS_ALERTS_AND_MAINTENANCE,
  ),
  ...kindTabs("NetworkSite", CreateFromRecordKind.NetworkSite, [
    CreatedRecordKind.ScheduledMaintenance,
  ]),
  ...kindTabs(
    "Service",
    CreateFromRecordKind.Service,
    INCIDENTS_ALERTS_AND_MAINTENANCE,
  ),
  ...kindTabs("StatusPages", CreateFromRecordKind.StatusPage, [
    CreatedRecordKind.Announcement,
  ]),
  /*
   * An inventory item's tabs list what its typed row - a host, a service, a
   * cluster - carries, and create with that row picked.
   */
  ...INCIDENTS_ALERTS_AND_MAINTENANCE.map(
    (created: CreatedRecordKind): RecordTabShape => {
      return {
        file: `Pages/Inventory/View/${
          created === CreatedRecordKind.Incident
            ? "Incidents"
            : created === CreatedRecordKind.Alert
              ? "Alerts"
              : "ScheduledMaintenance"
        }.tsx`,
        created: created,
        kind: "inventory",
      };
    },
  ),
];

// Record tabs that list such records but create none, and why.
const TABS_WITHOUT_CREATE: Record<string, string> = {
  "Pages/Slo/View/Incidents.tsx":
    "an SLO's incidents are declared by its burn-rate rules and linked to it; one made by hand would never list here",
  "Pages/Slo/View/Alerts.tsx":
    "an SLO's alerts are raised by its burn-rate rules and linked to it; one made by hand would never list here",
};

// Record tabs that create without carrying their record, and why.
const TABS_THAT_CARRY_NOTHING: Record<string, string> = {
  "Pages/MonitorGroup/View/Incidents.tsx":
    "a monitor group is not something an incident names; picking every monitor in it would put the incident on each monitor's status pages and notify their subscribers, which is the maintainer's call",
  "Pages/MonitorGroup/View/Alerts.tsx":
    "a monitor group is not something an alert names, and an alert is raised on one monitor",
};

// What a tab hands its table, as the source writes it.
const getCarriedRecord: (shape: RecordTabShape) => string = (
  shape: RecordTabShape,
): string => {
  if (shape.kind === "inventory") {
    return "createFrom={getCreateFromRecordForLinkedResource(resource)}";
  }

  if (shape.created === CreatedRecordKind.Announcement) {
    return "statusPageId={modelId}";
  }

  return `createFrom={{ kind: CreateFromRecordKind.${shape.kind}, id: modelId }}`;
};

/*
 * The page file the router draws for each page, read from the Routes
 * files: `<Component {...props} pageRoute={RouteMap[PageMap.KEY] as Route}`
 * and the import that names Component.
 */
const getRoutedPageFiles: () => Map<string, string> = (): Map<
  string,
  string
> => {
  const routed: Map<string, string> = new Map();
  const routesDirectory: string = path.join(DASHBOARD_SRC, "Routes");

  for (const fileName of fs.readdirSync(routesDirectory)) {
    if (!fileName.endsWith(".tsx")) {
      continue;
    }

    const source: string = tight(`Routes/${fileName}`);
    const imports: Map<string, string> = new Map();

    for (const match of source.matchAll(
      /import(\w+)from"\.\.\/Pages\/([^"]+)";/g,
    )) {
      imports.set(match[1]!, `Pages/${match[2]!}.tsx`);
    }

    for (const match of source.matchAll(
      /<(\w+)\{\.\.\.props\}pageRoute=\{RouteMap\[PageMap\.(\w+)\]asRoute\}/g,
    )) {
      const file: string | undefined = imports.get(match[1]!);

      if (file) {
        routed.set(match[2]!, file);
      }
    }
  }

  return routed;
};

const ROUTED_PAGE_FILES: Map<string, string> = getRoutedPageFiles();

// Every record tab: a page under a View folder that draws one of the tables.
const findRecordTabsWithTables: () => Array<{
  file: string;
  created: CreatedRecordKind;
}> = (): Array<{ file: string; created: CreatedRecordKind }> => {
  const found: Array<{ file: string; created: CreatedRecordKind }> = [];

  for (const full of listFiles(path.join(DASHBOARD_SRC, "Pages"))) {
    const file: string = path
      .relative(DASHBOARD_SRC, full)
      .split(path.sep)
      .join("/");

    if (!file.includes("/View/")) {
      continue;
    }

    const source: string = dense(file);

    for (const created of Object.keys(
      TABLE_MODULES,
    ) as Array<CreatedRecordKind>) {
      const imported: RegExpMatchArray | null = source.match(
        new RegExp(
          `import (\\w+) from "(?:\\.\\./)+${TABLE_MODULES[created]}";`,
        ),
      );

      if (imported && source.includes(`<${imported[1]!} `)) {
        found.push({ file: file, created: created });
      }
    }
  }

  return found;
};

describe("every record tab that creates carries its record", () => {
  test("the routes are read: every page the guard knows is drawn", () => {
    expect(ROUTED_PAGE_FILES.size).toBeGreaterThan(100);
    expect(ROUTED_PAGE_FILES.get("MONITOR_VIEW_INCIDENTS")).toBe(
      "Pages/Monitor/View/Incidents.tsx",
    );
  });

  test("each record tab with an incidents, alerts, maintenance or announcements list is listed here", () => {
    const listed: Array<string> = [
      ...RECORD_TABS.map((shape: RecordTabShape): string => {
        return `${shape.file} (${shape.created})`;
      }),
      ...Object.keys(TABS_WITHOUT_CREATE).map((file: string): string => {
        return `${file} (${file.endsWith("Alerts.tsx") ? CreatedRecordKind.Alert : CreatedRecordKind.Incident})`;
      }),
      ...Object.keys(TABS_THAT_CARRY_NOTHING).map((file: string): string => {
        return `${file} (${file.endsWith("Alerts.tsx") ? CreatedRecordKind.Alert : CreatedRecordKind.Incident})`;
      }),
    ].sort();

    expect(
      findRecordTabsWithTables()
        .map((tab: { file: string; created: CreatedRecordKind }): string => {
          return `${tab.file} (${tab.created})`;
        })
        .sort(),
    ).toEqual(listed);
  });

  test.each(RECORD_TABS)(
    "$file hands its table its record, and offers create",
    (shape: RecordTabShape) => {
      const source: string = dense(shape.file);

      expect(canonical(source)).toContain(canonical(getCarriedRecord(shape)));
      expect(source).not.toContain("disableCreate");
      // The create values no table ever drew a form with are gone.
      expect(source).not.toContain("createInitialValues");
    },
  );

  test.each(RECORD_TABS)(
    "$file is the tab the shared module goes back through",
    (shape: RecordTabShape) => {
      if (shape.kind === "inventory") {
        // Its row's own tab is the one: a host's, a service's, a cluster's.
        return;
      }

      const tab: RecordTab | undefined = getCreateFromRecordDefinition(
        shape.kind,
      ).tabs[shape.created];

      expect(tab).toBeDefined();
      expect(ROUTED_PAGE_FILES.get(tab!.page)).toBe(shape.file);
    },
  );

  test("every tab the shared module names is a listed tab that carries that kind", () => {
    for (const definition of CREATE_FROM_RECORD_KINDS) {
      for (const created of Object.keys(
        definition.tabs,
      ) as Array<CreatedRecordKind>) {
        const tab: RecordTab = definition.tabs[created]!;
        const file: string | undefined = ROUTED_PAGE_FILES.get(tab.page);

        expect(`${definition.kind} ${created}: ${file}`).toBe(
          `${definition.kind} ${created}: ${
            RECORD_TABS.find((shape: RecordTabShape): boolean => {
              return (
                shape.kind === definition.kind && shape.created === created
              );
            })?.file
          }`,
        );
      }
    }
  });

  test("the listed exceptions are still exceptions, and say why", () => {
    for (const file of Object.keys(TABS_WITHOUT_CREATE)) {
      expect(dense(file)).toContain("disableCreate={true}");
      expect(TABS_WITHOUT_CREATE[file]!.length).toBeGreaterThan(20);
    }

    for (const file of Object.keys(TABS_THAT_CARRY_NOTHING)) {
      expect(dense(file)).not.toContain("createFrom");
      expect(TABS_THAT_CARRY_NOTHING[file]!.length).toBeGreaterThan(20);
    }
  });

  test("an inventory item creates with the row it points at, for every kind of row", () => {
    const linked: string = dense("Components/Inventory/LinkedResource.ts");

    expect(linked).toContain(
      "[LinkedResourceKind.Service]: CreateFromRecordKind.Service,",
    );
    expect(linked).toContain(
      "[LinkedResourceKind.Host]: CreateFromRecordKind.Host,",
    );
    expect(linked).toContain(
      "[LinkedResourceKind.KubernetesCluster]: CreateFromRecordKind.KubernetesCluster,",
    );

    for (const kind of [
      CreateFromRecordKind.Service,
      CreateFromRecordKind.Host,
      CreateFromRecordKind.KubernetesCluster,
    ]) {
      for (const created of INCIDENTS_ALERTS_AND_MAINTENANCE) {
        expect(getCreateFromRecordField(kind, created)).not.toBeNull();
      }
    }
  });
});

describe("the tables put the record into every create button", () => {
  const TABLES: Array<{
    file: string;
    created: CreatedRecordKind;
    createPage: string;
    // Every navigation to the create page, as the table writes it.
    navigations: Array<string>;
  }> = [
    {
      file: "Components/Incident/IncidentsTable.tsx",
      created: CreatedRecordKind.Incident,
      createPage: "PageMap.INCIDENT_CREATE",
      navigations: [
        "RouteUtil.getPageRoute(PageMap.INCIDENT_CREATE,{query:createQuery,})",
        "RouteUtil.getPageRoute(PageMap.INCIDENT_CREATE,{query:{...createQuery,incidentTemplateId:incidentTemplateId.toString(),},})",
      ],
    },
    {
      file: "Components/Alert/AlertsTable.tsx",
      created: CreatedRecordKind.Alert,
      createPage: "PageMap.ALERT_CREATE",
      navigations: [
        "RouteUtil.getPageRoute(PageMap.ALERT_CREATE,{query:createQuery,})",
      ],
    },
    {
      file: "Components/ScheduledMaintenance/ScheduledMaintenanceTable.tsx",
      created: CreatedRecordKind.ScheduledMaintenance,
      createPage: "PageMap.SCHEDULED_MAINTENANCE_EVENT_CREATE",
      navigations: [
        "RouteUtil.getPageRoute(PageMap.SCHEDULED_MAINTENANCE_EVENT_CREATE,{query:createQuery},)",
        "RouteUtil.getPageRoute(PageMap.SCHEDULED_MAINTENANCE_EVENT_CREATE,{query:{...createQuery,scheduledMaintenanceTemplateId:scheduledMaintenanceTemplateId.toString(),},},)",
      ],
    },
  ];

  test.each(TABLES)(
    "$file builds the query from the record it was handed",
    ({ file, created }: { file: string; created: CreatedRecordKind }) => {
      const source: string = tight(file);

      expect(source).toContain(
        "createFrom?:CreateFromRecordAddress|undefined;",
      );
      expect(source).toContain(
        `constcreateQuery:Dictionary<string>=getCreateFromRecordQuery(CreatedRecordKind.${created},props.createFrom,);`,
      );
    },
  );

  test.each(TABLES)(
    "$file opens the create page with it from every button, and no other way",
    ({
      file,
      createPage,
      navigations,
    }: {
      file: string;
      createPage: string;
      navigations: Array<string>;
    }) => {
      const source: string = tight(file);

      for (const navigation of navigations) {
        expect(countOf(source, navigation)).toBe(1);
      }

      // Every mention of the create page is one of those navigations.
      expect(countOf(source, createPage)).toBe(navigations.length);
    },
  );

  test("the alerts list takes no create values: it draws no create form", () => {
    const source: string = dense("Components/Alert/AlertsTable.tsx");

    expect(source).not.toContain("createInitialValues");
    expect(source).not.toContain("initialValuesForAlert");
    expect(source).not.toContain("showCreateForm");
  });

  test("announcements build their address the shared way", () => {
    const source: string = tight("Components/Announcement/AnnouncementForm.ts");

    expect(source).toContain(
      "getCreateFromRecordQuery(CreatedRecordKind.Announcement,params.statusPageId?{kind:CreateFromRecordKind.StatusPage,id:params.statusPageId}:null,)",
    );
    expect(source).toContain(
      "exportconstANNOUNCEMENT_STATUS_PAGE_QUERY_PARAM:string=getCreateFromRecordDefinition(CreateFromRecordKind.StatusPage).queryParam;",
    );
  });
});

describe("every create page reads its record the one way", () => {
  const CREATE_PAGE_FILES: Record<CreatedRecordKind, string> = {
    [CreatedRecordKind.Incident]: "Pages/Incidents/Create.tsx",
    [CreatedRecordKind.Alert]: "Pages/Alerts/Create.tsx",
    [CreatedRecordKind.ScheduledMaintenance]:
      "Pages/ScheduledMaintenanceEvents/Create.tsx",
    [CreatedRecordKind.Announcement]:
      "Pages/StatusPages/AnnouncementCreate.tsx",
  };

  test("the create pages are the ones the router draws", () => {
    for (const created of Object.keys(
      CREATE_PAGE_FILES,
    ) as Array<CreatedRecordKind>) {
      expect(ROUTED_PAGE_FILES.get(CREATE_PAGES[created].page)).toBe(
        CREATE_PAGE_FILES[created],
      );
    }
  });

  test.each(Object.values(CreatedRecordKind) as Array<CreatedRecordKind>)(
    "%s: looks the record up with useRecordToCreateFrom, waits for it, and picks it",
    (created: CreatedRecordKind) => {
      const source: string = tight(CREATE_PAGE_FILES[created]);

      expect(
        countOf(source, `useRecordToCreateFrom(CreatedRecordKind.${created},)`),
      ).toBe(1);
      expect(source).toContain(
        `record:recordToCreateFrom.record,created:CreatedRecordKind.${created},`,
      );
      // The form latches its first values, so it is drawn once the record is in.
      expect(source).toContain("recordToCreateFrom.isLoading");
    },
  );

  test.each(Object.values(CreatedRecordKind) as Array<CreatedRecordKind>)(
    "%s: reads no record parameter of its own",
    (created: CreatedRecordKind) => {
      const source: string = dense(CREATE_PAGE_FILES[created]);

      for (const definition of CREATE_FROM_RECORD_KINDS) {
        expect(source).not.toContain(`"${definition.queryParam}"`);
      }

      expect(source).not.toContain("ANNOUNCEMENT_STATUS_PAGE_QUERY_PARAM");
    },
  );
});

describe("the create forms offer every resource they can be opened from", () => {
  /*
   * The picker shows only the types a page names in its list, and the page
   * writes back only what its onChange splits out and its hidden fields
   * register: a record of any other type would be dropped on save.
   *
   * A form can ask with more than one picker: Declare Incident and Create
   * Scheduled Maintenance Event ask for the monitors on their own, and for
   * everything else in a second picker, as the record's Affected Resources
   * Edit does. `lists` names the create page's lists in the order its
   * pickers are drawn, and the Edit's pickers must offer the same lists in
   * the same order.
   */
  const FORMS: Array<{
    created: CreatedRecordKind;
    file: string;
    lists: Array<string>;
    edit: string;
  }> = [
    {
      created: CreatedRecordKind.Incident,
      file: "Pages/Incidents/Create.tsx",
      lists: ["MONITOR_RESOURCE_TYPES", "OTHER_AFFECTED_RESOURCE_TYPES"],
      edit: "Components/Incident/IncidentAffectedResourcesFormFields.tsx",
    },
    {
      created: CreatedRecordKind.Alert,
      file: "Pages/Alerts/Create.tsx",
      lists: ["OTHER_AFFECTED_RESOURCE_TYPES"],
      edit: "Pages/Alerts/View/Index.tsx",
    },
    {
      created: CreatedRecordKind.ScheduledMaintenance,
      file: "Pages/ScheduledMaintenanceEvents/Create.tsx",
      lists: ["MONITOR_RESOURCE_TYPES", "OTHER_AFFECTED_RESOURCE_TYPES"],
      edit: "Components/ScheduledMaintenance/ScheduledMaintenanceAffectedResourcesFormFields.tsx",
    },
  ];

  const typesInCreateList: (file: string, list: string) => Array<string> = (
    file: string,
    list: string,
  ): Array<string> => {
    const block: string | undefined = dense(file).match(
      new RegExp(
        `const ${list}: Array<AffectedResourceType> = \\[([^\\]]*)\\];`,
      ),
    )?.[1];

    expect(block).toBeDefined();

    return Array.from(block!.matchAll(/"(\w+)"/g)).map(
      (match: RegExpMatchArray): string => {
        return match[1]!;
      },
    );
  };

  // Each of the Edit's pickers' lists, in the order they are drawn.
  const typesInEditLists: (file: string) => Array<Array<string>> = (
    file: string,
  ): Array<Array<string>> => {
    const blocks: Array<string> = Array.from(
      dense(file).matchAll(/resourceTypes=\{\[([^\]]*)\]\}/g),
    ).map((match: RegExpMatchArray): string => {
      return match[1]!;
    });

    expect(blocks.length).toBeGreaterThan(0);

    return blocks.map((block: string): Array<string> => {
      return Array.from(block.matchAll(/"(\w+)"/g)).map(
        (match: RegExpMatchArray): string => {
          return match[1]!;
        },
      );
    });
  };

  test.each(FORMS)(
    "$file offers what the record's own Edit offers, picker by picker",
    ({
      file,
      lists,
      edit,
    }: {
      file: string;
      lists: Array<string>;
      edit: string;
    }) => {
      expect(
        lists.map((list: string): Array<string> => {
          return typesInCreateList(file, list);
        }),
      ).toEqual(typesInEditLists(edit));
    },
  );

  test.each(FORMS)(
    "$file picks, writes back and registers every kind it can be opened from",
    ({
      created,
      file,
      lists,
    }: {
      created: CreatedRecordKind;
      file: string;
      lists: Array<string>;
    }) => {
      const source: string = tight(file);
      const offered: Array<string> = lists.flatMap(
        (list: string): Array<string> => {
          return typesInCreateList(file, list);
        },
      );

      for (const kind of getCreateFromRecordKinds(created)) {
        const key: string = getCreateFromRecordField(kind, created)!.key;

        // Its field is a form field...
        expect(
          `${kind}: ${new RegExp(`field:\\{${key}:true,?\\}`).test(source)}`,
        ).toBe(`${kind}: true`);

        if (
          created === CreatedRecordKind.Alert &&
          kind === CreateFromRecordKind.Monitor
        ) {
          // ...the alert's one monitor, in its own dropdown.
          expect(source).toContain("dropdownModal:{type:Monitor,");
          continue;
        }

        // ...the picker offers the type, and its onChange keeps the pick.
        expect(offered).toContain(kind);
        expect(source).toContain(`${key}:payload.${key},`);
      }
    },
  );
});

describe("the trail is drawn where the breadcrumbs are", () => {
  const COMMON_PAGE: string = path.join(
    DASHBOARD_SRC,
    "..",
    "..",
    "..",
    "..",
    "Common",
    "UI",
    "Components",
    "Page",
    "Page.tsx",
  );

  /*
   * The create pages sit in their product's layout, whose Page draws the
   * breadcrumbs. The Page itself takes a trail from the page inside it -
   * once, for every layout - rather than each layout wiring it up.
   */
  test("the shared Page draws the trail a page inside it hands up, before its own", () => {
    const source: string = fs
      .readFileSync(COMMON_PAGE, "utf8")
      .replace(/\s+/g, "");

    expect(source).toContain(
      "<PageBreadcrumbsContext.Providervalue={setInnerBreadcrumbLinks}>",
    );
    expect(source).toContain(
      "constbreadcrumbLinks:Array<Link>|undefined=innerBreadcrumbLinks||props.breadcrumbLinks;",
    );
    expect(source).toContain("<Breadcrumbslinks={breadcrumbLinks}/>");
  });

  test("the record's trail is handed up by the one hook every create page uses", () => {
    expect(
      tight("Components/CreateFromRecord/useRecordToCreateFrom.ts"),
    ).toContain("usePageBreadcrumbLinks(breadcrumbLinks);");
  });

  test("the layouts need no wiring of their own", () => {
    for (const file of [
      "Pages/Incidents/Layout.tsx",
      "Pages/Alerts/Layout.tsx",
      "Pages/ScheduledMaintenanceEvents/Layout.tsx",
    ]) {
      expect(dense(file)).not.toContain("CreateFromRecord");
    }
  });

  test("a create page that draws its own Page draws the trail it is given", () => {
    // Announcements are drawn outside the status page layout, on a Page of their own.
    expect(tight("Pages/StatusPages/AnnouncementCreate.tsx")).toContain(
      "constbreadcrumbLinks:Array<Link>=recordToCreateFrom.breadcrumbLinks||[",
    );
  });
});

describe("a create page starts over when its address changes", () => {
  /*
   * The page reads its address once and its form latches its first values:
   * opened again on the same route at another address, it is drawn afresh.
   */
  test.each([
    ["Routes/IncidentsRoutes.tsx", "IncidentCreate"],
    ["Routes/AlertRoutes.tsx", "AlertCreate"],
    [
      "Routes/ScheduleMaintenanceEventsRoutes.tsx",
      "ScheduledMaintenanceEventCreate",
    ],
    ["Routes/StatusPagesRoutes.tsx", "AnnouncementCreate"],
  ])("%s keys %s by its address", (file: string, page: string) => {
    const source: string = tight(file);

    expect(source).toContain(`<RemountOnAddressChange><${page}{...props}`);
    expect(countOf(source, `<${page}{...props}`)).toBe(1);
  });

  test("the key is the address's query", () => {
    expect(
      tight("Components/CreateFromRecord/RemountOnAddressChange.tsx"),
    ).toContain("<Fragmentkey={location.search}>{props.children}</Fragment>");
  });
});

describe("the shared module", () => {
  test("names every create page's record kinds by the tabs that create them", () => {
    for (const created of Object.values(
      CreatedRecordKind,
    ) as Array<CreatedRecordKind>) {
      for (const kind of getCreateFromRecordKinds(created)) {
        const definition: CreateFromRecordKindDefinition =
          getCreateFromRecordDefinition(kind);

        expect(definition.tabs[created]).toBeDefined();
      }
    }
  });

  test("stays React-free, so these tests can read it", () => {
    const source: string = dense(
      "Components/CreateFromRecord/CreateFromRecord.ts",
    );

    expect(source).not.toMatch(/from "react/);
    expect(source).not.toContain("RouteMap");
    expect(source).not.toContain("ModelAPI");
  });
});

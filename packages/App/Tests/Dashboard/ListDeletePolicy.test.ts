import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import ts from "typescript";

/*
 * "Please also have delete options here and in bulk actions. Please do this
 * for resources that you recommend (usually resources that have bulk actions
 * and are deletable)." - the maintainer, looking at the Status Pages list,
 * whose rows' ⋯ menus held only Show ID.
 *
 * A list's `isDeleteable` is the one switch for its Delete: on, each row's ⋯
 * menu and Bulk Actions both offer it (BaseModelTable adds the bulk one); off,
 * neither does. This guard reads every ModelTable in the Dashboard, the Admin
 * Dashboard and (when the checkout has it) the enterprise dashboards, and
 * holds them to the policy the change set:
 *
 *   1. A list that offers bulk actions offers Delete, unless it is one of the
 *      few below that say why not. A new list with bulk actions has to take
 *      a side.
 *   2. No list asks for the default bulk Delete while keeping Delete off its
 *      rows: the two go together.
 *   3. The lists this change turned Delete on for keep it.
 *   4. The live list of an archivable resource says that archiving is the
 *      reversible way off it; its Archived page does not.
 *   5. A list that deletes through a dialog of its own keeps the shared
 *      Delete off, so there is one way in.
 *
 * What Delete does once on - the dialogs, the bulk run, the result - is
 * tested on the shared table in Common/Tests/UI/Components/ModelTable, on the
 * real Status Pages list in packages/E2E/ListDelete, and on every list it was
 * turned on for in Common/Tests/App/Dashboard/ListDeleteEveryList.
 */

const PACKAGES_DIR: string = path.resolve(__dirname, "..", "..", "..");
const REPOSITORY_DIR: string = path.resolve(PACKAGES_DIR, "..");
const DASHBOARD_SRC: string = path.join(
  PACKAGES_DIR,
  "App",
  "FeatureSet",
  "Dashboard",
  "src",
);
const ADMIN_SRC: string = path.join(
  PACKAGES_DIR,
  "App",
  "FeatureSet",
  "AdminDashboard",
  "src",
);

/*
 * App Test deletes ee/ before it runs, so there only the core screens are
 * read; the Enterprise Edition Test workflow runs this guard with ee/ present.
 */
const ENTERPRISE_DIRS: Array<string> = [
  path.join(REPOSITORY_DIR, "ee", "Dashboard"),
  path.join(REPOSITORY_DIR, "ee", "AdminDashboard"),
].filter((directory: string): boolean => {
  return fs.existsSync(directory);
});

/*
 * Lists that offer bulk actions but no Delete, and why. Keyed by the file's
 * path from packages/App/FeatureSet.
 */
const BULK_WITHOUT_DELETE: Record<string, string> = {
  "Dashboard/src/Pages/Global/ActiveIncidentEpisodes.tsx":
    "Lists episodes from every project the person belongs to: a delete from here would be sent to whichever project is open, not to the episode's own.",
  "Dashboard/src/Pages/Global/ActiveAlertEpisodes.tsx":
    "Lists episodes from every project the person belongs to: a delete from here would be sent to whichever project is open, not to the episode's own.",
  "Dashboard/src/Pages/Monitor/View/Slos.tsx":
    "A monitor's SLOs: an SLO can measure several monitors, so it is deleted from the SLOs list, not from under one of its monitors.",
  "Dashboard/src/Pages/NetworkDevice/View/Interfaces.tsx":
    "Interfaces are discovered from the device on every SNMP poll, so a deleted one comes back; Mute is how one stops being monitored.",
  "Dashboard/src/Components/TelemetryService/TelemetryServiceTable.tsx":
    "No page uses it; the Services list is Pages/Service/Services.tsx.",
  "AdminDashboard/src/Pages/Projects/Index.tsx":
    "Deleting a project deletes everything in it for every member: it is done on the project's own page, after its name is typed. Bulk Actions keep their own Delete.",
  "AdminDashboard/src/Pages/Users/Index.tsx":
    "Deleting a user removes them from every project: Bulk Actions keep their own Delete, with its own words, and the user's own page has one.",
};

/*
 * The lists this change turned Delete on for, with no bulk actions of their
 * own (rule 1 holds the ones with bulk actions): settings lists whose records
 * each have their own Delete page.
 */
const DELETABLE_SETTINGS_LISTS: Array<string> = [
  "Dashboard/src/Pages/Teams/Index.tsx",
  "Dashboard/src/Pages/Settings/APIKeys.tsx",
  "Dashboard/src/Pages/Settings/TelemetryIngestionKeys.tsx",
  "Dashboard/src/Components/Announcement/AnnouncementsTable.tsx",
  "Dashboard/src/Pages/Incidents/Settings/IncidentTemplates.tsx",
  "Dashboard/src/Pages/Incidents/Settings/IncidentNoteTemplates.tsx",
  "Dashboard/src/Pages/Incidents/Settings/IncidentPostmortemTemplates.tsx",
  "Dashboard/src/Pages/ScheduledMaintenanceEvents/Settings/ScheduledMaintenanceTemplates.tsx",
  "Dashboard/src/Pages/ScheduledMaintenanceEvents/Settings/ScheduledMaintenanceNoteTemplates.tsx",
  "Dashboard/src/Pages/Alerts/Settings/AlertNoteTemplates.tsx",
  "Dashboard/src/Pages/StatusPages/Settings/StatusPageAnnouncementTemplates.tsx",
  "Dashboard/src/Pages/StatusPages/Settings/SubscriberNotificationTemplates.tsx",
  "Dashboard/src/Pages/Monitor/Settings/MonitorTemplates.tsx",
  "Dashboard/src/Pages/Logs/Settings/Pipelines.tsx",
  "Dashboard/src/Pages/Logs/Settings/DropFilters.tsx",
  "Dashboard/src/Pages/Traces/Settings/Pipelines.tsx",
  "Dashboard/src/Pages/Traces/Settings/DropFilters.tsx",
  "Dashboard/src/Pages/Forms/Forms.tsx",
];

/*
 * Lists whose records are deleted through a dialog of their own (which says
 * which notification rules use a phone number, say): the shared Delete stays
 * off, in the rows and in Bulk Actions.
 */
const OWN_DELETE_FLOW_LISTS: Array<string> = [
  "Dashboard/src/Components/NotificationMethods/SMS.tsx",
  "Dashboard/src/Components/NotificationMethods/Call.tsx",
  "Dashboard/src/Components/NotificationMethods/Email.tsx",
  "Dashboard/src/Components/NotificationMethods/WhatsApp.tsx",
  "Dashboard/src/Components/NotificationMethods/Telegram.tsx",
  "Dashboard/src/Components/NotificationMethods/Push.tsx",
  "Dashboard/src/Components/NotificationMethods/Slack.tsx",
  "Dashboard/src/Components/NotificationMethods/MicrosoftTeams.tsx",
  "Dashboard/src/Components/NotificationMethods/Webhook.tsx",
];

interface ModelTableUse {
  // The file's path from packages/App/FeatureSet (or from ee/).
  file: string;
  line: number;
  // The isDeleteable attribute's expression, as written; "" when absent.
  isDeleteable: string;
  bulkActions: string;
  deleteConfirmationWarning: string;
  modelType: string;
}

type WalkFunction = (directory: string, files: Array<string>) => void;

const walk: WalkFunction = (directory: string, files: Array<string>): void => {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === "build") {
      continue;
    }

    const full: string = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      walk(full, files);
    } else if (entry.name.endsWith(".tsx")) {
      files.push(full);
    }
  }
};

type ReadUsesFunction = (
  file: string,
  relativeTo: string,
) => Array<ModelTableUse>;

const readUses: ReadUsesFunction = (
  file: string,
  relativeTo: string,
): Array<ModelTableUse> => {
  const text: string = fs.readFileSync(file, "utf8");

  if (!text.includes("<ModelTable")) {
    return [];
  }

  const source: ts.SourceFile = ts.createSourceFile(
    file,
    text,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const uses: Array<ModelTableUse> = [];

  const visit: (node: ts.Node) => void = (node: ts.Node): void => {
    if (
      (ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) &&
      node.tagName.getText(source) === "ModelTable"
    ) {
      const attribute: (name: string) => string = (name: string): string => {
        for (const property of node.attributes.properties) {
          if (
            ts.isJsxAttribute(property) &&
            property.name.getText(source) === name
          ) {
            const initializer: ts.JsxAttributeValue | undefined =
              property.initializer;

            if (!initializer) {
              return "true";
            }

            if (ts.isJsxExpression(initializer)) {
              return initializer.expression?.getText(source) || "";
            }

            return initializer.getText(source);
          }
        }

        return "";
      };

      uses.push({
        file: path.relative(relativeTo, file).split(path.sep).join("/"),
        line:
          source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1,
        isDeleteable: attribute("isDeleteable"),
        bulkActions: attribute("bulkActions"),
        deleteConfirmationWarning: attribute("deleteConfirmationWarning"),
        modelType: attribute("modelType"),
      });
    }

    ts.forEachChild(node, visit);
  };

  visit(source);

  return uses;
};

const FEATURE_SET_DIR: string = path.join(PACKAGES_DIR, "App", "FeatureSet");

const files: Array<string> = [];
walk(DASHBOARD_SRC, files);
walk(ADMIN_SRC, files);

const uses: Array<ModelTableUse> = files.flatMap((file: string) => {
  return readUses(file, FEATURE_SET_DIR);
});

const enterpriseUses: Array<ModelTableUse> = ENTERPRISE_DIRS.flatMap(
  (directory: string) => {
    const enterpriseFiles: Array<string> = [];
    walk(directory, enterpriseFiles);
    return enterpriseFiles.flatMap((file: string) => {
      return readUses(file, REPOSITORY_DIR);
    });
  },
);

const allUses: Array<ModelTableUse> = [...uses, ...enterpriseUses];

const isOff: (use: ModelTableUse) => boolean = (
  use: ModelTableUse,
): boolean => {
  return use.isDeleteable === "false" || use.isDeleteable === "";
};

const usesIn: (file: string) => Array<ModelTableUse> = (
  file: string,
): Array<ModelTableUse> => {
  return uses.filter((use: ModelTableUse): boolean => {
    return use.file === file;
  });
};

describe("every list's Delete", () => {
  test("the guard finds the lists (the checks below are not vacuous)", () => {
    expect(uses.length).toBeGreaterThan(250);
    expect(
      uses.filter((use: ModelTableUse): boolean => {
        return Boolean(use.bulkActions);
      }).length,
    ).toBeGreaterThan(70);
    expect(usesIn("Dashboard/src/Pages/StatusPages/StatusPages.tsx")).toEqual([
      expect.objectContaining({ isDeleteable: "true" }),
    ]);
  });

  test("a list with bulk actions offers Delete, or is one of the few that say why not", () => {
    const withoutDelete: Array<string> = uses
      .filter((use: ModelTableUse): boolean => {
        return Boolean(use.bulkActions) && isOff(use);
      })
      .map((use: ModelTableUse): string => {
        return use.file;
      });

    expect([...new Set(withoutDelete)].sort()).toEqual(
      Object.keys(BULK_WITHOUT_DELETE).sort(),
    );
  });

  test.each(Object.entries(BULK_WITHOUT_DELETE))(
    "%s says why it has no Delete",
    (_file: string, reason: string) => {
      expect(reason.length).toBeGreaterThan(40);
    },
  );

  test("no list asks for the default bulk Delete while keeping Delete off its rows", () => {
    const contradictions: Array<string> = allUses
      .filter((use: ModelTableUse): boolean => {
        return (
          use.bulkActions.includes("ModalTableBulkDefaultActions.Delete") &&
          use.isDeleteable === "false"
        );
      })
      .map((use: ModelTableUse): string => {
        return `${use.file}:${use.line}`;
      });

    expect(contradictions).toEqual([]);
  });

  test.each(DELETABLE_SETTINGS_LISTS)(
    "%s offers Delete in its rows' ⋯ menus",
    (file: string) => {
      const found: Array<ModelTableUse> = usesIn(file);

      expect(found.length).toBeGreaterThan(0);

      for (const use of found) {
        expect(use.isDeleteable).toBe("true");
      }
    },
  );

  test.each(OWN_DELETE_FLOW_LISTS)(
    "%s keeps the shared Delete off: its own dialog is the one way in",
    (file: string) => {
      const found: Array<ModelTableUse> = usesIn(file);

      expect(found.length).toBe(1);
      expect(found[0]!.isDeleteable).toBe("false");
      expect(found[0]!.bulkActions).toBe("");
    },
  );

  test("the monitors table deletes by default, and a monitor group's members unassign instead", () => {
    const monitorTable: Array<ModelTableUse> = usesIn(
      "Dashboard/src/Components/Monitor/MonitorTable.tsx",
    );

    expect(monitorTable).toHaveLength(1);
    expect(monitorTable[0]!.isDeleteable).toBe("props.isDeleteable !== false");

    const groupMonitors: string = fs.readFileSync(
      path.join(DASHBOARD_SRC, "Pages", "MonitorGroup", "View", "Monitors.tsx"),
      "utf8",
    );

    expect(groupMonitors).toContain("isDeleteable={false}");
    expect(groupMonitors).toContain('title: "Unassign"');
  });
});

// The hooks' two lists of actions, as whole identifiers.
const ARCHIVE_ACTIONS: RegExp = /\barchiveBulkActions\b/;
const UNARCHIVE_ACTIONS: RegExp = /\bunarchiveBulkActions\b/;

describe("archive instead of delete", () => {
  /*
   * The live lists of archivable resources: they offer Archive in Bulk
   * Actions (archiveBulkActions), and their Delete dialogs say so.
   */
  const liveArchivable: Array<ModelTableUse> = uses.filter(
    (use: ModelTableUse): boolean => {
      return (
        ARCHIVE_ACTIONS.test(use.bulkActions) &&
        !UNARCHIVE_ACTIONS.test(use.bulkActions)
      );
    },
  );

  const archivedOnly: Array<ModelTableUse> = uses.filter(
    (use: ModelTableUse): boolean => {
      return (
        UNARCHIVE_ACTIONS.test(use.bulkActions) &&
        !ARCHIVE_ACTIONS.test(use.bulkActions)
      );
    },
  );

  test("finds the archivable lists", () => {
    expect(liveArchivable.length).toBeGreaterThan(20);
    expect(archivedOnly.length).toBeGreaterThan(20);
  });

  test.each(liveArchivable.map((use: ModelTableUse) => [use.file, use]))(
    "%s says archiving is the reversible way off the list",
    (_file: string, use: ModelTableUse) => {
      expect(use.isDeleteable).toBe("true");
      expect(use.deleteConfirmationWarning).toBe("ARCHIVE_INSTEAD_OF_DELETE");
    },
  );

  test.each(archivedOnly.map((use: ModelTableUse) => [use.file, use]))(
    "%s, an Archived page, deletes without offering to archive",
    (_file: string, use: ModelTableUse) => {
      expect(use.isDeleteable).toBe("true");
      expect(use.deleteConfirmationWarning).toBe("");
    },
  );

  test("a table drawn for both says it on the live list only", () => {
    for (const file of [
      "Dashboard/src/Components/Monitor/MonitorTable.tsx",
      "Dashboard/src/Components/Inventory/InventoryTable.tsx",
    ]) {
      const [use] = usesIn(file);

      expect(use!.deleteConfirmationWarning.replace(/\s+/g, " ")).toBe(
        "isArchivedView ? undefined : ARCHIVE_INSTEAD_OF_DELETE",
      );
    }
  });
});

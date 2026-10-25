import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import ts from "typescript";
import { getModelTypeByName } from "Common/Models/DatabaseModels/Index";
import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import { TableColumnMetadata } from "Common/Types/Database/TableColumn";
import TableColumnType from "Common/Types/Database/TableColumnType";
import { escapeRegExp } from "Common/Utils/RegExpEscape";

/*
 * "I dont see the button to assign to me, change priority, change status
 * here for cases ... Side note: Please also check the entire product for
 * missing things in more menu just like this and build those as well." -
 * the maintainer.
 *
 * The audit went through every list of the Dashboard, the Admin Dashboard
 * and the Enterprise screens and asked of each which everyday actions of
 * its kind its rows' ⋯ menu lacked. Where one did, the row offers it now
 * through the shared row actions (Common/UI/Components/BulkUpdate and the
 * shared table): the same action as the list's Bulk Actions, with the
 * permission and the question the record's own page has. Actions people
 * take rarely (Duplicate, Run Now, Test) stay on the record's page.
 *
 * This guard keeps it so:
 *
 *   1. A list of records switched on and off (an isEnabled column) offers
 *      Enable or Disable in each row: the shared table's rowSwitch, the
 *      shared switch's row actions (useSwitchActions), or RuleTable, which
 *      gives it to every rule with the switch.
 *   2. A list that archives or unarchives in Bulk Actions does it in each
 *      row's ⋯ too.
 *   3. Every incident, alert, episode and scheduled maintenance list offers
 *      the record page's state moves, Change Severity (maintenance has
 *      none), and Assign to Me and Add Owner in each row, through the shared
 *      state engine (EventView/useEventStateActions).
 *   4. A status page's subscriber lists offer Unsubscribe in each row.
 *   5. The exceptions list offers Resolve or Reopen, Archive or Unarchive.
 *   6. No list writes a switch from a row action of its own, but the lists
 *      named below that word it their own way.
 *
 * A list that may not follow a rule says why below; a new list has to take
 * a side.
 */

const PACKAGES_DIR: string = path.resolve(__dirname, "..", "..", "..");
const REPOSITORY_DIR: string = path.resolve(PACKAGES_DIR, "..");
const FEATURE_SET_DIR: string = path.join(PACKAGES_DIR, "App", "FeatureSet");
const DASHBOARD_SRC: string = path.join(FEATURE_SET_DIR, "Dashboard", "src");
const ADMIN_SRC: string = path.join(FEATURE_SET_DIR, "AdminDashboard", "src");

// App Test deletes ee/ before it runs; the Enterprise Edition Test keeps it.
const EE_ADMIN_DIR: string = path.join(REPOSITORY_DIR, "ee", "AdminDashboard");
const EE_DASHBOARD_DIR: string = path.join(REPOSITORY_DIR, "ee", "Dashboard");
const HAS_EE: boolean = fs.existsSync(path.join(REPOSITORY_DIR, "ee"));

/*
 * Lists that turn their rows on and off in their own words - Turn on and
 * Turn off, each with its own sentence and its own notice on the page - so
 * the shared Enable and Disable would offer the same twice. Keyed by the
 * file's path from packages/App/FeatureSet, or from the repository for ee/.
 */
const OWN_ROW_SWITCH: Record<string, string> = {
  "Dashboard/src/Components/AI/Connect/LlmConnectionsTable.tsx":
    "AI connections: Turn on and Turn off in each row, beside Read now and Test, each saying what it does - off, it stops reading, and what it brought in stays.",
  "Dashboard/src/Components/Cloud/Connect/CloudConnectionsTable.tsx":
    "Cloud connections: Turn on and Turn off in each row, beside Test, each saying what it does - off, it stops reading the account, and what it brought in stays.",
  "Dashboard/src/Pages/ScheduledMaintenanceEvents/Settings/ScheduledMaintenanceCalendarSettings.tsx":
    "Scheduled Maintenance > Settings > External Calendars: Turn on and Turn off in each row, beside Read now - off, the calendar is not read and its events are hidden from everyone.",
  "ee/Dashboard/AuditLogExport/AuditLogExportTable.tsx":
    "Audit Log Export (Enterprise): Turn on and Turn off in each row, each saying what it does - off, it stops sending, keeps its place and catches up when turned back on.",
};

// How those lists title their own Turn on and Turn off.
const OWN_TURN_ON: RegExp = /title: (?:"Turn on"|\w+\.turnOnAction),/;
const OWN_TURN_OFF: RegExp = /title: (?:"Turn off"|\w+\.turnOffAction),/;

/*
 * Lists of switched records whose rows do not offer Enable or Disable at
 * all, and why.
 */
const ROW_SWITCH_NOT_OFFERED: Record<string, string> = {
  "Dashboard/src/Pages/Workflow/Archived.tsx":
    "An archived workflow is out of service whatever its switch says: its rows offer Unarchive, and a workflow is turned on again on the live list.",
  "Dashboard/src/Pages/Slo/Archived.tsx":
    "An archived SLO is not evaluated whatever its switch says: its rows offer Unarchive, and an SLO is turned on again on the live list.",
  "Dashboard/src/Pages/Settings/TelemetryIngestionKeys.tsx":
    "A key's switch is its kill switch for a key that is misused - rare, and turned on the key's own page, whose Status says what it does (telemetry sent with the key is refused). The list does not show it.",
  "AdminDashboard/src/Pages/Settings/GlobalSSO/Index.tsx":
    "Admin Dashboard > Global SSO: a provider is set up and turned on once, on its own page; turning one off ends every sign-in it gave, in every project on the server.",
  "AdminDashboard/src/Pages/Settings/GlobalOIDC/Index.tsx":
    "Admin Dashboard > Global OIDC: a provider is set up and turned on once, on its own page; turning one off ends every sign-in it gave, in every project on the server.",
  "AdminDashboard/src/Pages/Settings/GlobalSSO/View.tsx":
    "A provider's attached projects are attached and removed: an attachment is not edited from the Admin Dashboard, and its switch is set with it.",
  "AdminDashboard/src/Pages/Settings/GlobalOIDC/View.tsx":
    "A provider's attached projects are attached and removed: an attachment is not edited from the Admin Dashboard, and its switch is set with it.",
};

/*
 * Lists of incidents, alerts, episodes or scheduled maintenance events that
 * are not drawn by the five tables, and why.
 */
const EVENT_LIST_NOT_OFFERED: Record<string, string> = {
  "Dashboard/src/Pages/Global/ActiveIncidents.tsx":
    "Lists incidents from every project the person belongs to: a state move reads the row's own project's states, which are not the open project's.",
  "Dashboard/src/Pages/Global/ActiveAlerts.tsx":
    "Lists alerts from every project the person belongs to: a state move reads the row's own project's states, which are not the open project's.",
  "Dashboard/src/Pages/Global/ActiveIncidentEpisodes.tsx":
    "Lists episodes from every project the person belongs to: a state move reads the row's own project's states, which are not the open project's.",
  "Dashboard/src/Pages/Global/ActiveAlertEpisodes.tsx":
    "Lists episodes from every project the person belongs to: a state move reads the row's own project's states, which are not the open project's.",
  "Dashboard/src/Components/Postmortem/PostmortemsTable.tsx":
    "Each row of Incidents > Postmortems is an incident seen as its postmortem, whose actions are the postmortem's; the incident's state is moved on the incidents list.",
};

interface ListUse {
  // The file's path from packages/App/FeatureSet, or from the repository for ee/.
  file: string;
  line: number;
  tag: string;
  modelType: string;
  actionButtons: string;
  bulkActions: string;
  rowSwitch: string;
  source: string;
}

type WalkFunction = (directory: string, files: Array<string>) => void;

const walk: WalkFunction = (directory: string, files: Array<string>): void => {
  if (!fs.existsSync(directory)) {
    return;
  }

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

// The shared table, and the rule lists' table that draws it.
const LIST_TAGS: Array<string> = ["ModelTable", "RuleTable"];

type ReadUsesFunction = (file: string, relativeTo: string) => Array<ListUse>;

const readUses: ReadUsesFunction = (
  file: string,
  relativeTo: string,
): Array<ListUse> => {
  const text: string = fs.readFileSync(file, "utf8");

  if (!text.includes("<ModelTable") && !text.includes("<RuleTable")) {
    return [];
  }

  const source: ts.SourceFile = ts.createSourceFile(
    file,
    text,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const uses: Array<ListUse> = [];

  const visit: (node: ts.Node) => void = (node: ts.Node): void => {
    if (
      (ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) &&
      LIST_TAGS.includes(node.tagName.getText(source))
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
        tag: node.tagName.getText(source),
        modelType: attribute("modelType"),
        actionButtons: attribute("actionButtons"),
        bulkActions: attribute("bulkActions"),
        rowSwitch: attribute("rowSwitch"),
        source: text,
      });
    }

    ts.forEachChild(node, visit);
  };

  visit(source);

  return uses;
};

const coreFiles: Array<string> = [];
walk(DASHBOARD_SRC, coreFiles);
walk(ADMIN_SRC, coreFiles);

const eeFiles: Array<string> = [];
walk(EE_ADMIN_DIR, eeFiles);
walk(EE_DASHBOARD_DIR, eeFiles);

const coreUses: Array<ListUse> = coreFiles.flatMap((file: string) => {
  return readUses(file, FEATURE_SET_DIR);
});

const eeUses: Array<ListUse> = eeFiles.flatMap((file: string) => {
  return readUses(file, REPOSITORY_DIR);
});

const uses: Array<ListUse> = [...coreUses, ...eeUses];

// The lists that live under ee/, which App Test does not have.
const isEeFile: (file: string) => boolean = (file: string): boolean => {
  return file.startsWith("ee/");
};

// The exemptions that apply to the files this run can read.
const present: (exemptions: Record<string, string>) => Array<string> = (
  exemptions: Record<string, string>,
): Array<string> => {
  return Object.keys(exemptions)
    .filter((file: string): boolean => {
      return HAS_EE || !isEeFile(file);
    })
    .sort();
};

type ModelClass = { new (): BaseModel };

// A modelType that is a model's name ("Workflow"), not an expression.
const MODEL_NAME: RegExp = /^[A-Z][A-Za-z]+$/;

const modelOf: (use: ListUse) => ModelClass | null = (
  use: ListUse,
): ModelClass | null => {
  if (!MODEL_NAME.test(use.modelType)) {
    return null;
  }

  return getModelTypeByName(use.modelType) as ModelClass | null;
};

const hasBooleanColumn: (modelType: ModelClass, column: string) => boolean = (
  modelType: ModelClass,
  column: string,
): boolean => {
  const metadata: TableColumnMetadata | null | undefined =
    new modelType().getTableColumnMetadata(column) as
      | TableColumnMetadata
      | null
      | undefined;

  return metadata?.type === TableColumnType.Boolean;
};

// Whether a list offers the shared Enable or Disable in each row.
const offersRowSwitch: (use: ListUse) => boolean = (use: ListUse): boolean => {
  return (
    use.tag === "RuleTable" ||
    Boolean(use.rowSwitch) ||
    (use.source.includes("useSwitchActions<") &&
      use.source.includes('column: "isEnabled"') &&
      use.actionButtons.includes("...switchRowActions")) ||
    (use.source.includes("useSloBulkActions()") &&
      use.actionButtons.includes("...rowActions"))
  );
};

const filesOf: (list: Array<ListUse>) => Array<string> = (
  list: Array<ListUse>,
): Array<string> => {
  return [
    ...new Set(
      list.map((use: ListUse): string => {
        return use.file;
      }),
    ),
  ].sort();
};

// The lists of records with a switch, whichever way they are drawn.
const switchedLists: Array<ListUse> = uses.filter((use: ListUse): boolean => {
  const modelType: ModelClass | null = modelOf(use);

  return Boolean(modelType && hasBooleanColumn(modelType, "isEnabled"));
});

const readSource: (file: string) => string = (file: string): string => {
  return fs.readFileSync(path.join(FEATURE_SET_DIR, file), "utf8");
};

describe("the audit's lists (the checks below are not vacuous)", () => {
  test("finds the lists, the switched ones and the rule lists", () => {
    expect(coreUses.length).toBeGreaterThan(250);
    expect(switchedLists.length).toBeGreaterThan(90);
    expect(
      uses.filter((use: ListUse): boolean => {
        return use.tag === "RuleTable";
      }).length,
    ).toBeGreaterThan(30);
  });

  test.each([
    ...Object.entries(OWN_ROW_SWITCH),
    ...Object.entries(ROW_SWITCH_NOT_OFFERED),
    ...Object.entries(EVENT_LIST_NOT_OFFERED),
  ])("%s says why", (_file: string, reason: string) => {
    expect(reason.length).toBeGreaterThan(40);
  });
});

describe("1. a list of records switched on and off offers Enable or Disable in each row", () => {
  test("every one does, or says why not", () => {
    expect(
      filesOf(
        switchedLists.filter((use: ListUse): boolean => {
          return !offersRowSwitch(use);
        }),
      ),
    ).toEqual(
      [...present(OWN_ROW_SWITCH), ...present(ROW_SWITCH_NOT_OFFERED)].sort(),
    );
  });

  test("a list that words its own Turn on and Turn off is not given the shared switch as well", () => {
    for (const use of switchedLists) {
      if (!OWN_ROW_SWITCH[use.file]) {
        continue;
      }

      expect({ file: use.file, rowSwitch: use.rowSwitch }).toEqual({
        file: use.file,
        rowSwitch: "",
      });
      expect(use.source).toMatch(OWN_TURN_ON);
      expect(use.source).toMatch(OWN_TURN_OFF);
    }
  });

  test("every rule list gets it from RuleTable, which offers it for a rule with the switch", () => {
    const ruleTable: string = fs.readFileSync(
      path.join(
        PACKAGES_DIR,
        "Common",
        "UI",
        "Components",
        "RuleRun",
        "RuleTable.tsx",
      ),
      "utf8",
    );

    expect(ruleTable).toContain("tableProps.rowSwitch ||");
    expect(ruleTable).toContain("(hasRuleEnabledColumn(model)");
    expect(ruleTable).toContain("column: RULE_ENABLED_COLUMN as keyof");
  });

  test.each([
    "Dashboard/src/Pages/Logs/Settings/DropFilters.tsx",
    "Dashboard/src/Pages/Logs/Settings/Pipelines.tsx",
    "Dashboard/src/Pages/Monitor/View/Probes.tsx",
    "Dashboard/src/Pages/OnCallDuty/IncomingCallPolicies.tsx",
    "Dashboard/src/Pages/Runbook/Runbooks.tsx",
    "Dashboard/src/Pages/SecurityEvents/DetectionRules.tsx",
    "Dashboard/src/Pages/SecurityEvents/Playbooks.tsx",
    "Dashboard/src/Pages/Traces/Settings/DropFilters.tsx",
    "Dashboard/src/Pages/Traces/Settings/Pipelines.tsx",
    "Dashboard/src/Pages/Workflow/Workflows.tsx",
  ])(
    "%s, which turns its rows in bulk, offers the same switch in each row",
    (file: string) => {
      const list: ListUse | undefined = switchedLists.find(
        (use: ListUse): boolean => {
          return use.file === file;
        },
      );

      expect(list).toBeDefined();
      expect(list!.source).toContain("useSwitchActions<");
      expect(list!.source).toContain("rowActions: switchRowActions,");
      expect(list!.source).toContain("bulkActions: switchBulkActions,");
      expect(list!.source).not.toContain("useBulkSwitchActions<");
      expect(list!.actionButtons).toMatch(/\.\.\.switchRowActions\b/);
      expect(list!.bulkActions).toMatch(/\.\.\.switchBulkActions\b/);
    },
  );

  test("the monitors list offers Enable or Disable Monitoring in each row, asking first as the monitor's page does", () => {
    const monitorTable: string = readSource(
      "Dashboard/src/Components/Monitor/MonitorTable.tsx",
    );

    expect(monitorTable).toContain("rowActions: monitorSwitchRowActions,");
    expect(monitorTable).toContain("...monitorSwitchRowActions,");
    // The question the monitor's Monitoring switch asks (MonitoringCard).
    expect(monitorTable).toContain("getRowConfirmation: (data: {");
    expect(monitorTable).toContain(
      "getTurnOffMonitoringConfirmation(!data.value);",
    );
  });

  test("the SLO lists offer it from the SLOs' shared actions", () => {
    for (const file of [
      "Dashboard/src/Pages/Slo/Slos.tsx",
      "Dashboard/src/Pages/Monitor/View/Slos.tsx",
    ]) {
      const source: string = readSource(file);

      expect(source).toContain("useSloBulkActions()");
      expect(source).toMatch(/actionButtons=\{\[\.\.\.rowActions\b/);
    }
  });
});

describe("2. a list that archives or unarchives in Bulk Actions does it in each row too", () => {
  const filesSpreading: (name: string) => Array<string> = (
    name: string,
  ): Array<string> => {
    return filesOf(
      uses.filter((use: ListUse): boolean => {
        return use.source.includes(`...${name}`);
      }),
    );
  };

  const filesWithRows: (name: string) => Array<string> = (
    name: string,
  ): Array<string> => {
    return filesOf(
      uses.filter((use: ListUse): boolean => {
        return new RegExp(`\\b${escapeRegExp(name)}\\b`).test(
          use.actionButtons,
        );
      }),
    );
  };

  test("Archive", () => {
    const archiving: Array<string> = filesSpreading("archiveBulkActions");

    expect(archiving.length).toBeGreaterThan(20);
    expect(filesWithRows("archiveRowActions")).toEqual(archiving);
  });

  test("Unarchive", () => {
    const unarchiving: Array<string> = filesSpreading("unarchiveBulkActions");

    expect(unarchiving.length).toBeGreaterThan(20);
    expect(filesWithRows("unarchiveRowActions")).toEqual(unarchiving);
  });

  test("the shared archive actions give the row actions beside the bulk ones", () => {
    const archive: string = fs.readFileSync(
      path.join(
        PACKAGES_DIR,
        "Common",
        "UI",
        "Components",
        "BulkUpdate",
        "BulkArchiveActions.tsx",
      ),
      "utf8",
    );

    expect(archive).toContain("archiveRowActions:");
    expect(archive).toContain("unarchiveRowActions:");
  });
});

interface EventTable {
  file: string;
  model: string;
  kind: string;
  severity: string | null;
}

const EVENT_TABLES: Array<EventTable> = [
  {
    file: "Dashboard/src/Components/Incident/IncidentsTable.tsx",
    model: "Incident",
    kind: "EventStateKind.Incident",
    severity: "incidentSeverity",
  },
  {
    file: "Dashboard/src/Components/Alert/AlertsTable.tsx",
    model: "Alert",
    kind: "EventStateKind.Alert",
    severity: "alertSeverity",
  },
  {
    file: "Dashboard/src/Components/IncidentEpisode/IncidentEpisodesTable.tsx",
    model: "IncidentEpisode",
    kind: "EventStateKind.IncidentEpisode",
    severity: "incidentSeverity",
  },
  {
    file: "Dashboard/src/Components/AlertEpisode/AlertEpisodesTable.tsx",
    model: "AlertEpisode",
    kind: "EventStateKind.AlertEpisode",
    severity: "alertSeverity",
  },
  {
    file: "Dashboard/src/Components/ScheduledMaintenance/ScheduledMaintenanceTable.tsx",
    model: "ScheduledMaintenance",
    kind: "EventStateKind.ScheduledMaintenance",
    // A maintenance event has no severity.
    severity: null,
  },
];

describe("3. every incident, alert, episode and maintenance list offers its state moves, severity and owners in each row", () => {
  test("every list of them is one of the five tables, or says why not", () => {
    const models: Array<string> = EVENT_TABLES.map(
      (table: EventTable): string => {
        return table.model;
      },
    );
    const tables: Array<string> = EVENT_TABLES.map(
      (table: EventTable): string => {
        return table.file;
      },
    );

    expect(
      filesOf(
        uses.filter((use: ListUse): boolean => {
          return models.includes(use.modelType) && !tables.includes(use.file);
        }),
      ),
    ).toEqual(present(EVENT_LIST_NOT_OFFERED));
  });

  test.each(EVENT_TABLES)(
    "$file moves the state through the shared engine, in the row and in bulk",
    (table: EventTable) => {
      const source: string = readSource(table.file);
      const list: ListUse | undefined = uses.find((use: ListUse): boolean => {
        return use.file === table.file && use.modelType === table.model;
      });

      expect(source).toContain(`useEventStateActions<${table.model}>({`);
      expect(source).toContain(`kind: ${table.kind},`);
      expect(list).toBeDefined();
      expect(list!.actionButtons).toContain("...stateRowActions");
      expect(list!.bulkActions).toContain("...stateBulkActions");
      // The engine is the one way: no list draws the state dialog itself.
      expect(source).not.toContain("<BulkChangeStateModal");
    },
  );

  test.each(
    EVENT_TABLES.filter((table: EventTable): boolean => {
      return Boolean(table.severity);
    }),
  )(
    "$file offers Change Severity, from the project's own severities",
    (table: EventTable) => {
      const source: string = readSource(table.file);
      const list: ListUse | undefined = uses.find((use: ListUse): boolean => {
        return use.file === table.file && use.modelType === table.model;
      });

      expect(source).toMatch(
        new RegExp(
          `useValueChangeActions<${escapeRegExp(table.model)}, \\w+Severity>\\(\\{`,
        ),
      );
      expect(source).toContain(`column: "${table.severity}",`);
      expect(list!.actionButtons).toContain("...severityRowActions");
      expect(list!.bulkActions).toContain("...severityBulkActions");
    },
  );

  test.each(EVENT_TABLES)(
    "$file offers Assign to Me and Add Owner in each row, and Assign to Me in bulk",
    (table: EventTable) => {
      const source: string = readSource(table.file);
      const list: ListUse | undefined = uses.find((use: ListUse): boolean => {
        return use.file === table.file && use.modelType === table.model;
      });

      expect(source).toContain(`useBulkOwnerActions<${table.model}>({`);
      expect(source).toContain("offerAssignToMeInBulk: true,");
      expect(source).toContain("isOwnedByMe: (");
      expect(source).toContain("isOwnedByViewer({");
      expect(list!.actionButtons).toContain("...ownerRowActions");
      expect(list!.bulkActions).toContain("...ownerBulkActions");
    },
  );

  test("Change State and Change Severity wear the icons the lists' own State and Severity filters wear", () => {
    /*
     * The icon named after `marker` in a source: the IconProp the first
     * "icon: IconProp.X" after it names. Read with indexOf, not a pattern.
     */
    const iconAfter: (source: string, marker: string) => string = (
      source: string,
      marker: string,
    ): string => {
      const start: number = source.indexOf(marker);

      if (start === -1) {
        return "";
      }

      const iconStart: number = source.indexOf(
        "icon: IconProp.",
        start + marker.length,
      );

      if (iconStart === -1) {
        return "";
      }

      const name: string = source.slice(iconStart + "icon: IconProp.".length);

      return name.slice(0, name.indexOf(","));
    };

    const filterIcons: { state: Set<string>; severity: Set<string> } = {
      state: new Set<string>(),
      severity: new Set<string>(),
    };

    for (const table of EVENT_TABLES) {
      const source: string = readSource(table.file);

      for (const [label, icons] of [
        ['label: "State",', filterIcons.state],
        ['label: "Severity",', filterIcons.severity],
      ] as Array<[string, Set<string>]>) {
        const icon: string = iconAfter(source, label);

        if (icon) {
          icons.add(icon);
        }
      }
    }

    // Every list that filters by them draws each the same way.
    expect([...filterIcons.state]).toHaveLength(1);
    expect([...filterIcons.severity]).toHaveLength(1);

    const engine: string = readSource(
      "Dashboard/src/Components/EventView/useEventStateActions.tsx",
    );

    expect(engine).toContain(
      `export const CHANGE_STATE_ICON: IconProp = IconProp.${[...filterIcons.state][0]};`,
    );
    // The row's Change State and the bulk one.
    expect(engine.split("icon: CHANGE_STATE_ICON,").length - 1).toBe(2);

    for (const table of EVENT_TABLES.filter((candidate: EventTable) => {
      return Boolean(candidate.severity);
    })) {
      expect({
        file: table.file,
        icon: iconAfter(readSource(table.file), 'title: "Change Severity",'),
      }).toEqual({ file: table.file, icon: [...filterIcons.severity][0] });
    }
  });

  test("the row's state moves come first, then severity, then owners", () => {
    for (const table of EVENT_TABLES) {
      const list: ListUse | undefined = uses.find((use: ListUse): boolean => {
        return use.file === table.file && use.modelType === table.model;
      });
      const order: Array<number> = [
        "...stateRowActions",
        ...(table.severity ? ["...severityRowActions"] : []),
        "...ownerRowActions",
      ].map((name: string): number => {
        return list!.actionButtons.indexOf(name);
      });

      expect({ file: table.file, order }).toEqual({
        file: table.file,
        order: [...order].sort((a: number, b: number): number => {
          return a - b;
        }),
      });
      expect(order[0]).toBeGreaterThanOrEqual(0);
    }
  });
});

describe("4. a status page's subscriber lists offer Unsubscribe in each row", () => {
  const SUBSCRIBER_PAGES: Array<string> = [
    "Email",
    "SMS",
    "Slack",
    "MicrosoftTeams",
    "Webhook",
  ].map((channel: string): string => {
    return `Dashboard/src/Pages/StatusPages/View/${channel}Subscribers.tsx`;
  });

  test.each(SUBSCRIBER_PAGES)("%s", (file: string) => {
    const list: ListUse | undefined = uses.find((use: ListUse): boolean => {
      return use.file === file;
    });

    expect(list).toBeDefined();
    expect(list!.source).toContain("useSubscriberRowActions();");
    expect(list!.actionButtons).toContain("...subscriberRowActions");
  });

  test("the row's Unsubscribe is the bulk one's row counterpart", () => {
    const hook: string = readSource(
      "Dashboard/src/Components/StatusPage/useSubscriberBulkActions.tsx",
    );

    expect(hook).toContain(
      "return useSwitchActions<StatusPageSubscriber>(SUBSCRIBER_SWITCH).rowActions;",
    );
  });
});

describe("5. the exceptions list offers its triage actions in each row", () => {
  test("Resolve or Reopen, Archive or Unarchive, read again after each", () => {
    const viewer: string = readSource(
      "Dashboard/src/Components/Exceptions/ExceptionsViewer.tsx",
    );
    const row: string = readSource(
      "Dashboard/src/Components/Exceptions/ExceptionRow.tsx",
    );

    expect(viewer).toContain("getExceptionRowActions({");
    expect(viewer).toContain("void fetchExceptions();");
    expect(row).toContain("<RowActions");
  });
});

/*
 * A row action that writes a switch itself: the record's switch in the data
 * of an update, by name or shorthand.
 */
const SWITCH_WRITE: RegExp =
  /data:\s*\{\s*(?:isEnabled|disableActiveMonitoring|isUnsubscribed|isArchived)\s*[:,}]/;

describe("6. no list writes a switch from a row action of its own", () => {
  test("but the lists that word it their own way", () => {
    const writing: Array<string> = filesOf(
      uses.filter((use: ListUse): boolean => {
        return Boolean(use.actionButtons) && SWITCH_WRITE.test(use.source);
      }),
    );

    expect(writing).toEqual(present(OWN_ROW_SWITCH));
  });

  test("the pattern finds one written out and one written short (it is not vacuous)", () => {
    expect(
      SWITCH_WRITE.test(
        "await ModelAPI.updateById<Workflow>({\n  id: item.id!,\n  modelType: Workflow,\n  data: {\n    isEnabled: false,\n  },\n});",
      ),
    ).toBe(true);
    expect(SWITCH_WRITE.test("data: { isEnabled },")).toBe(true);
    expect(SWITCH_WRITE.test("data: { isEnabledByDefault: true },")).toBe(
      false,
    );
  });
});

import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import ts from "typescript";
import { getModelTypeByName } from "Common/Models/DatabaseModels/Index";
import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import { TableColumnMetadata } from "Common/Types/Database/TableColumn";
import TableColumnType from "Common/Types/Database/TableColumnType";

/*
 * "Please also audit the entire app, and add bulk options to tables that
 * might need them." - the maintainer, on Admin Dashboard > Enterprise
 * Licenses.
 *
 * The audit went through every table of the Dashboard, the Admin Dashboard
 * and the Enterprise screens, and asked of each whether people manage its
 * rows in numbers. Where they do, the list's Bulk Actions offer what its
 * rows can be changed by, through the shared actions (Common/UI/Components/
 * BulkUpdate), one way everywhere: permission-checked on each row by the
 * server, a confirmation that counts and names the rows, and a result that
 * lists the rows that could not be changed and why.
 *
 * This guard keeps it so, for the lists that offer bulk actions (a list
 * with none is one whose rows are managed one at a time - settings,
 * history, logs):
 *
 *   1. A list of records that are switched on and off (an isEnabled column)
 *      offers Enable and Disable - the shared bulk switch.
 *   2. A list of records that carry labels offers Add and Remove Labels,
 *      and one whose records have owners offers Add and Remove Owner.
 *   3. No list writes a switch in a bulk loop of its own: the shared switch
 *      is the one way.
 *   4. A status page's subscriber lists offer Unsubscribe, and nothing
 *      subscribes people again in bulk.
 *   5. Admin Dashboard > Enterprise Licenses (with ee/ checked out) offers
 *      Delete in each row's ⋯ and in Bulk Actions, and Change Expiry Date.
 *
 * A list that may not follow a rule says why below; a new list with bulk
 * actions has to take a side.
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
 * Lists of switched records that offer bulk actions but not the switch, and
 * why. Keyed by the file's path from packages/App/FeatureSet.
 */
const SWITCH_NOT_OFFERED: Record<string, string> = {
  "Dashboard/src/Pages/Workflow/Archived.tsx":
    "An archived workflow is out of service whatever its switch says: the Archived page offers Unarchive, and a workflow is turned on again on the live list.",
  "Dashboard/src/Pages/Slo/Archived.tsx":
    "An archived SLO is not evaluated whatever its switch says: the Archived page offers Unarchive, and an SLO is turned on again on the live list.",
};

/*
 * Lists of labelled records that offer bulk actions but not Add and Remove
 * Labels, and why.
 */
const LABELS_NOT_OFFERED: Record<string, string> = {
  "Dashboard/src/Components/Postmortem/PostmortemsTable.tsx":
    "Each row of Incidents > Postmortems is an incident seen as its postmortem: an incident's labels are changed on the incidents list, which offers them in bulk.",
  "Dashboard/src/Components/SecurityCase/SecurityCasesTable.tsx":
    "The security case lists' bulk actions (assign, status, priority) belong to the security case actions work; labels there follow with it.",
};

/*
 * Lists of owned records that offer bulk actions but not Add and Remove
 * Owner, and why.
 */
const OWNERS_NOT_OFFERED: Record<string, string> = {
  "Dashboard/src/Components/TelemetryService/TelemetryServiceTable.tsx":
    "No page uses it; the Services list is Pages/Service/Services.tsx, which offers labels and owners.",
  "Dashboard/src/Pages/Global/ActiveIncidentEpisodes.tsx":
    "Lists episodes from every project the person belongs to: the owner picker offers the open project's people and teams, which are not every row's.",
  "Dashboard/src/Pages/Global/ActiveAlertEpisodes.tsx":
    "Lists episodes from every project the person belongs to: the owner picker offers the open project's people and teams, which are not every row's.",
};

/*
 * Archived pages list records that are out of service and offer Unarchive
 * alone: rules 1 and 2 are for the live lists.
 */
const ARCHIVED_PAGE: RegExp =
  /\/Archived\.tsx$|OnCallDutyPoliciesArchived\.tsx$/;

// A list drawn for both the live list and its Archived page (isArchivedView).
const ARCHIVED_VIEW_TABLES: Array<string> = [
  "Dashboard/src/Components/Monitor/MonitorTable.tsx",
  "Dashboard/src/Components/Inventory/InventoryTable.tsx",
];

interface ListUse {
  // The file's path from packages/App/FeatureSet, or from the repository for ee/.
  file: string;
  line: number;
  modelType: string;
  bulkActions: string;
  isDeleteable: string;
  getItemName: string;
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

type ReadUsesFunction = (file: string, relativeTo: string) => Array<ListUse>;

const readUses: ReadUsesFunction = (
  file: string,
  relativeTo: string,
): Array<ListUse> => {
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
  const uses: Array<ListUse> = [];

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
        modelType: attribute("modelType"),
        bulkActions: attribute("bulkActions"),
        isDeleteable: attribute("isDeleteable"),
        getItemName: attribute("getItemName"),
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

const coreUses: Array<ListUse> = coreFiles.flatMap((file: string) => {
  return readUses(file, FEATURE_SET_DIR);
});

const eeFiles: Array<string> = [];
walk(EE_ADMIN_DIR, eeFiles);
walk(EE_DASHBOARD_DIR, eeFiles);

const eeUses: Array<ListUse> = eeFiles.flatMap((file: string) => {
  return readUses(file, REPOSITORY_DIR);
});

type ModelClass = { new (): BaseModel };

// A modelType that is a model's name ("Workflow"), not an expression.
const MODEL_NAME: RegExp = /^[A-Z][A-Za-z]+$/;

// The model a list draws, when its modelType is a model's name.
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

const hasLabels: (modelType: ModelClass) => boolean = (
  modelType: ModelClass,
): boolean => {
  const metadata: TableColumnMetadata | null | undefined =
    new modelType().getTableColumnMetadata("labels") as
      | TableColumnMetadata
      | null
      | undefined;

  return metadata?.type === TableColumnType.EntityArray;
};

const hasOwners: (modelType: ModelClass) => boolean = (
  modelType: ModelClass,
): boolean => {
  const tableName: string | null = new modelType().tableName;

  return Boolean(
    tableName &&
      getModelTypeByName(`${tableName}OwnerUser`) &&
      getModelTypeByName(`${tableName}OwnerTeam`),
  );
};

// What a list's file offers in Bulk Actions, through the shared actions.
const offersSwitch: (use: ListUse) => boolean = (use: ListUse): boolean => {
  return (
    (use.source.includes("useBulkSwitchActions<") &&
      use.source.includes('column: "isEnabled"')) ||
    use.source.includes("useSloBulkActions()")
  );
};

const offersLabels: (use: ListUse) => boolean = (use: ListUse): boolean => {
  return (
    use.source.includes("useBulkLabelActions<") ||
    use.source.includes("useSloBulkActions()")
  );
};

const offersOwners: (use: ListUse) => boolean = (use: ListUse): boolean => {
  return (
    use.source.includes("useBulkOwnerActions<") ||
    use.source.includes("useSloBulkActions()")
  );
};

// The live lists with bulk actions, and the model each draws.
const liveListsWithBulkActions: Array<[ListUse, ModelClass]> = coreUses
  .filter((use: ListUse): boolean => {
    return Boolean(use.bulkActions) && !ARCHIVED_PAGE.test(use.file);
  })
  .map((use: ListUse): [ListUse, ModelClass | null] => {
    return [use, modelOf(use)];
  })
  .filter((entry: [ListUse, ModelClass | null]): boolean => {
    return Boolean(entry[1]);
  }) as Array<[ListUse, ModelClass]>;

const filesWhere: (
  predicate: (use: ListUse, modelType: ModelClass) => boolean,
) => Array<string> = (
  predicate: (use: ListUse, modelType: ModelClass) => boolean,
): Array<string> => {
  return [
    ...new Set(
      liveListsWithBulkActions
        .filter(([use, modelType]: [ListUse, ModelClass]): boolean => {
          return predicate(use, modelType);
        })
        .map(([use]: [ListUse, ModelClass]): string => {
          return use.file;
        }),
    ),
  ].sort();
};

describe("the audit's lists (the checks below are not vacuous)", () => {
  test("finds the lists and their bulk actions", () => {
    expect(coreUses.length).toBeGreaterThan(250);
    expect(liveListsWithBulkActions.length).toBeGreaterThan(50);
  });

  test("tells a switched, a labelled and an owned model apart", () => {
    expect(hasBooleanColumn(getModelTypeByName("Workflow")!, "isEnabled")).toBe(
      true,
    );
    expect(hasBooleanColumn(getModelTypeByName("Host")!, "isEnabled")).toBe(
      false,
    );
    expect(hasLabels(getModelTypeByName("Runbook")!)).toBe(true);
    expect(hasLabels(getModelTypeByName("InventoryItem")!)).toBe(false);
    expect(hasOwners(getModelTypeByName("RumApplication")!)).toBe(true);
    expect(hasOwners(getModelTypeByName("Label")!)).toBe(false);
  });

  test.each([
    ...Object.entries(SWITCH_NOT_OFFERED),
    ...Object.entries(LABELS_NOT_OFFERED),
    ...Object.entries(OWNERS_NOT_OFFERED),
  ])("%s says why", (_file: string, reason: string) => {
    expect(reason.length).toBeGreaterThan(40);
  });
});

describe("1. a list of records switched on and off offers Enable and Disable", () => {
  test("every one does, or says why not", () => {
    const without: Array<string> = filesWhere(
      (use: ListUse, modelType: ModelClass): boolean => {
        return hasBooleanColumn(modelType, "isEnabled") && !offersSwitch(use);
      },
    );

    expect(without).toEqual(
      Object.keys(SWITCH_NOT_OFFERED)
        .sort()
        .filter((file: string): boolean => {
          return !ARCHIVED_PAGE.test(file);
        }),
    );
  });

  test("the lists the audit gave it", () => {
    expect(
      filesWhere((use: ListUse, modelType: ModelClass): boolean => {
        return hasBooleanColumn(modelType, "isEnabled") && offersSwitch(use);
      }),
    ).toEqual(
      [
        "Dashboard/src/Pages/Logs/Settings/DropFilters.tsx",
        "Dashboard/src/Pages/Logs/Settings/Pipelines.tsx",
        "Dashboard/src/Pages/Monitor/View/Probes.tsx",
        "Dashboard/src/Pages/Monitor/View/Slos.tsx",
        "Dashboard/src/Pages/OnCallDuty/IncomingCallPolicies.tsx",
        "Dashboard/src/Pages/Runbook/Runbooks.tsx",
        "Dashboard/src/Pages/SecurityEvents/DetectionRules.tsx",
        "Dashboard/src/Pages/SecurityEvents/Playbooks.tsx",
        "Dashboard/src/Pages/Slo/Slos.tsx",
        "Dashboard/src/Pages/Traces/Settings/DropFilters.tsx",
        "Dashboard/src/Pages/Traces/Settings/Pipelines.tsx",
        "Dashboard/src/Pages/Workflow/Workflows.tsx",
      ].sort(),
    );
  });

  test("the monitors list turns monitoring on and off through the shared switch too", () => {
    const monitorTable: string = fs.readFileSync(
      path.join(DASHBOARD_SRC, "Components", "Monitor", "MonitorTable.tsx"),
      "utf8",
    );

    expect(monitorTable).toContain("useBulkSwitchActions<Monitor>({");
    expect(monitorTable).toContain('column: "disableActiveMonitoring",');
    expect(monitorTable).toContain(
      "{ ...ENABLE_SWITCH_ACTION, value: false },",
    );
    expect(monitorTable).toContain(
      "{ ...DISABLE_SWITCH_ACTION, value: true },",
    );
    expect(monitorTable).toContain("...monitorSwitchBulkActions,");
  });

  test("every list the switch is on reads the column, so a row already in the state is left alone", () => {
    for (const [use, modelType] of liveListsWithBulkActions) {
      if (!hasBooleanColumn(modelType, "isEnabled") || !offersSwitch(use)) {
        continue;
      }

      const readsColumn: boolean =
        use.source.includes("isEnabled: true") ||
        use.source.includes("SLO_TABLE_SELECT_MORE_FIELDS");

      expect({ file: use.file, readsColumn }).toEqual({
        file: use.file,
        readsColumn: true,
      });
    }
  });
});

describe("2. a list of labelled or owned records offers Add and Remove Labels and Owners", () => {
  test("every list of labelled records offers labels, or says why not", () => {
    expect(
      filesWhere((use: ListUse, modelType: ModelClass): boolean => {
        return (
          hasLabels(modelType) &&
          !offersLabels(use) &&
          !ARCHIVED_VIEW_TABLES.includes(use.file)
        );
      }),
    ).toEqual(Object.keys(LABELS_NOT_OFFERED).sort());
  });

  test("every list of owned records offers owners, or says why not", () => {
    expect(
      filesWhere((use: ListUse, modelType: ModelClass): boolean => {
        return (
          hasOwners(modelType) &&
          !offersOwners(use) &&
          !ARCHIVED_VIEW_TABLES.includes(use.file)
        );
      }),
    ).toEqual(Object.keys(OWNERS_NOT_OFFERED).sort());
  });

  test.each([
    ["Dashboard/src/Pages/Rum/RumApplications.tsx", "RumApplication"],
    ["Dashboard/src/Pages/Cloud/CloudResources.tsx", "CloudResource"],
    ["Dashboard/src/Pages/Cloud/MonitoredResources.tsx", "CloudResource"],
    [
      "Dashboard/src/Pages/Serverless/ServerlessFunctions.tsx",
      "ServerlessFunction",
    ],
    ["Dashboard/src/Pages/Runbook/Runbooks.tsx", "Runbook"],
  ])(
    "%s, which the audit found without them, offers labels and owners",
    (file: string, model: string) => {
      const source: string = fs.readFileSync(
        path.join(FEATURE_SET_DIR, file),
        "utf8",
      );

      expect(source).toContain(`useBulkLabelActions<${model}>(`);
      expect(source).toContain(`useBulkOwnerActions<${model}>(`);
      expect(source).toContain("...labelBulkActions,");
      expect(source).toContain("...ownerBulkActions,");
      // The dialogs the two actions open are drawn.
      expect(source).toContain("{labelBulkActionModals}");
      expect(source).toContain("{ownerBulkActionModals}");
    },
  );

  test.each([
    ["Dashboard/src/Pages/Monitor/Settings/MonitorProbes.tsx", "Probe"],
    ["Dashboard/src/Pages/NetworkDevice/Devices.tsx", "NetworkDevice"],
    [
      "Dashboard/src/Components/IncidentEpisode/IncidentEpisodesTable.tsx",
      "IncidentEpisode",
    ],
    [
      "Dashboard/src/Components/AlertEpisode/AlertEpisodesTable.tsx",
      "AlertEpisode",
    ],
  ])(
    "%s, which offered labels alone, offers owners too",
    (file: string, model: string) => {
      const source: string = fs.readFileSync(
        path.join(FEATURE_SET_DIR, file),
        "utf8",
      );

      expect(source).toContain(`useBulkOwnerActions<${model}>(`);
      expect(source).toContain("...ownerBulkActions");
      expect(source).toContain("{ownerBulkActionModals}");
    },
  );
});

// A bulk action that writes a switch itself, rather than through the shared one.
const HAND_WRITTEN_SWITCH: RegExp =
  /updateById<\w+>\(\{\s*id: [\w.!]+,\s*modelType: \w+,\s*data: \{\s*(isEnabled|disableActiveMonitoring|isUnsubscribed): (true|false),/;

describe("3. no list writes a switch in a bulk loop of its own", () => {
  test("the shared bulk switch is the one way", () => {
    const handWritten: Array<string> = [...coreFiles, ...eeFiles]
      .filter((file: string): boolean => {
        const text: string = fs.readFileSync(file, "utf8");

        return (
          text.includes("BulkActionOnClickProps") &&
          HAND_WRITTEN_SWITCH.test(text)
        );
      })
      .map((file: string): string => {
        return path.relative(REPOSITORY_DIR, file);
      });

    expect(handWritten).toEqual([]);
  });

  test("the pattern finds a hand-written one (it is not vacuous)", () => {
    expect(
      HAND_WRITTEN_SWITCH.test(
        "await ModelAPI.updateById<Monitor>({\n  id: monitor.id,\n  modelType: Monitor,\n  data: {\n    disableActiveMonitoring: true,\n  },\n});",
      ),
    ).toBe(true);
  });
});

describe("4. subscriber lists offer Unsubscribe, and nothing subscribes people again in bulk", () => {
  const SUBSCRIBER_PAGES: Array<string> = [
    "Email",
    "SMS",
    "Slack",
    "MicrosoftTeams",
    "Webhook",
  ].map((channel: string): string => {
    return `Dashboard/src/Pages/StatusPages/View/${channel}Subscribers.tsx`;
  });

  test.each(SUBSCRIBER_PAGES)("%s offers Unsubscribe", (file: string) => {
    const source: string = fs.readFileSync(
      path.join(FEATURE_SET_DIR, file),
      "utf8",
    );

    expect(source).toContain("useSubscriberBulkActions();");
    expect(source).toContain("buttons: [...subscriberBulkActions],");
    expect(source).toContain("isUnsubscribed: true,");
  });

  test("Unsubscribe is the subscribers' one bulk switch", () => {
    const hook: string = fs.readFileSync(
      path.join(
        DASHBOARD_SRC,
        "Components",
        "StatusPage",
        "useSubscriberBulkActions.tsx",
      ),
      "utf8",
    );

    expect(hook).toContain('column: "isUnsubscribed",');
    expect(hook).toContain("actions: [UNSUBSCRIBE_SWITCH_ACTION],");
    expect(hook).not.toContain("isUnsubscribed: false");
  });
});

describe("5. Admin Dashboard > Enterprise Licenses", () => {
  const licenses: Array<ListUse> = eeUses.filter((use: ListUse): boolean => {
    return use.file === "ee/AdminDashboard/EnterpriseLicenses/Pages/Index.tsx";
  });

  (HAS_EE ? test : test.skip)(
    "offers Delete in each row's ⋯ and in Bulk Actions, with Change Expiry Date, and names each license by company and masked key",
    () => {
      expect(licenses).toHaveLength(1);

      const [list] = licenses;

      expect(list!.isDeleteable).toBe("true");
      expect(list!.bulkActions).toContain("...licenseBulkActions");
      expect(list!.bulkActions).toContain(
        "ModalTableBulkDefaultActions.Delete",
      );
      expect(list!.getItemName).toContain("getLicenseItemName(");
      expect(list!.source).toContain("{licenseBulkModals}");
    },
  );

  test("the core shell draws the Enterprise screens only (no list of its own)", () => {
    const shell: string = fs.readFileSync(
      path.join(ADMIN_SRC, "Pages", "EnterpriseLicenses", "Index.tsx"),
      "utf8",
    );

    expect(shell).not.toContain("<ModelTable");
  });
});

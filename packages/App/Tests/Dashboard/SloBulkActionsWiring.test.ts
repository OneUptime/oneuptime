import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import ServiceLevelObjective from "Common/Models/DatabaseModels/ServiceLevelObjective";
import ServiceLevelObjectiveOwnerTeam from "Common/Models/DatabaseModels/ServiceLevelObjectiveOwnerTeam";
import ServiceLevelObjectiveOwnerUser from "Common/Models/DatabaseModels/ServiceLevelObjectiveOwnerUser";
import { TableColumnMetadata } from "Common/Types/Database/TableColumn";
import TableColumnType from "Common/Types/Database/TableColumnType";
import {
  SLO_BULK_ARCHIVE_CONFIRM_MESSAGE,
  SLO_BULK_UNARCHIVE_CONFIRM_MESSAGE,
} from "../../FeatureSet/Dashboard/src/Components/Slo/SloArchiveCopy";

/*
 * Bulk "Add Labels" / "Remove Labels" / "Add Owner" / "Remove Owner" and
 * "Archive" / "Unarchive" on the SLO tables is entirely wiring: a hook call, a
 * prop on ModelTable, and a `{modals}` rendered as a sibling. The App suite runs
 * in a plain Node environment with no renderer, so every way of getting it
 * wrong is silent. Drop the prop and the table still renders, with checkboxes
 * that select rows and then offer nothing. Drop the `{modals}` and the buttons
 * appear, are clickable, and open a modal that was never mounted. Neither fails
 * to compile, and neither fails anywhere else in this repo.
 *
 * So these read the sources and assert the exact expressions, the same way
 * RecommendationPageWiring.test.ts pins the recommendation pages. Sources are
 * whitespace-squashed first so prettier re-wrapping a line cannot turn a real
 * regression check into a red herring, and the negative assertions read a
 * comment-stripped copy so that prose naming the thing that was removed cannot
 * fail the test checking it is gone.
 *
 * The last describe walks the dashboard tree rather than naming files, so a
 * fourth SLO table added later fails here until it is wired too. It matches raw
 * text with regexes rather than parsing JSX: an earlier revision of this file
 * carried a hand-rolled tag scanner that ran on the comment-stripped copy,
 * where a `videoLink={URL.fromString("https://...")}` prop leaves an
 * unterminated quote and the scan slides past the element it was reading.
 */

const DASHBOARD_SRC: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
);

const HOOK_MODULE: Array<string> = [
  "Components",
  "Slo",
  "useSloBulkActions.tsx",
];
const SLOS_PAGE: Array<string> = ["Pages", "Slo", "Slos.tsx"];
const ARCHIVED_SLOS_PAGE: Array<string> = ["Pages", "Slo", "Archived.tsx"];
const MONITOR_SLOS_PAGE: Array<string> = [
  "Pages",
  "Monitor",
  "View",
  "Slos.tsx",
];

/*
 * `unarchiveBulkActions` contains `archiveBulkActions`, so a plain substring
 * check cannot tell a table that unarchives from one that archives.
 */
const ARCHIVE_ACTIONS_NAME: RegExp = /\barchiveBulkActions\b/;

function squash(text: string): string {
  return text.replace(/\s+/g, " ");
}

function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/.*$/gm, " ");
}

function readRawAt(absolutePath: string): string {
  return fs.readFileSync(absolutePath, "utf8");
}

function readSourceAt(absolutePath: string): string {
  return squash(readRawAt(absolutePath));
}

function readCodeAt(absolutePath: string): string {
  return squash(stripComments(readRawAt(absolutePath)));
}

function readSource(...relativeParts: Array<string>): string {
  return readSourceAt(path.join(DASHBOARD_SRC, ...relativeParts));
}

function readCode(...relativeParts: Array<string>): string {
  return readCodeAt(path.join(DASHBOARD_SRC, ...relativeParts));
}

const HOOK_CODE: string = readCode(...HOOK_MODULE);

describe("the shared hook module hands each bulk-action hook what it needs", () => {
  test("it imports all three hooks, the action type they return, and the SLO archive copy", () => {
    expect(HOOK_CODE).toContain(
      'import useBulkArchiveActions from "Common/UI/Components/BulkUpdate/BulkArchiveActions";',
    );
    expect(HOOK_CODE).toContain(
      'import useBulkLabelActions from "Common/UI/Components/BulkUpdate/BulkLabelActions";',
    );
    expect(HOOK_CODE).toContain(
      'import useBulkOwnerActions from "Common/UI/Components/BulkUpdate/BulkOwnerActions";',
    );
    expect(HOOK_CODE).toContain(
      'import { BulkActionButtonSchema } from "Common/UI/Components/BulkUpdate/BulkUpdateForm";',
    );
    expect(HOOK_CODE).toContain(
      squash(
        'import { SLO_BULK_ARCHIVE_CONFIRM_MESSAGE, SLO_BULK_UNARCHIVE_CONFIRM_MESSAGE, } from "./SloArchiveCopy";',
      ),
    );
    expect(HOOK_CODE).toContain(
      "bulkActions: Array<BulkActionButtonSchema<ServiceLevelObjective>>;",
    );
  });

  test("the label hook is told which model the table lists", () => {
    expect(HOOK_CODE).toContain(
      squash(
        "useBulkLabelActions<ServiceLevelObjective>({ modelType: ServiceLevelObjective, })",
      ),
    );
  });

  test("the owner hook gets both junction models and the shared key", () => {
    expect(HOOK_CODE).toContain(
      squash(
        "useBulkOwnerActions<ServiceLevelObjective>({ ownerUserModelType: ServiceLevelObjectiveOwnerUser, ownerTeamModelType: ServiceLevelObjectiveOwnerTeam, resourceIdField: SLO_OWNER_RESOURCE_ID_FIELD, })",
      ),
    );

    /*
     * Through the constant, not a literal spelled out again at the call site.
     * Inlining it would leave the model-backed check below guarding a constant
     * that nothing reads, and would drop the typed annotation with it.
     */
    expect(HOOK_CODE).not.toContain('resourceIdField: "');
  });

  test("the archive hook gets the SLO model, the SLO's own names, and the SLO's own copy", () => {
    /*
     * The generic defaults say archived resources "will keep collecting
     * telemetry" - the opposite of an archived SLO, which stops being
     * evaluated. Without the copy, every SLO table would say so.
     */
    expect(HOOK_CODE).toContain(
      squash(
        'useBulkArchiveActions<ServiceLevelObjective>({ modelType: ServiceLevelObjective, singularName: "SLO", pluralName: "SLOs", archiveConfirmMessage: SLO_BULK_ARCHIVE_CONFIRM_MESSAGE, unarchiveConfirmMessage: SLO_BULK_UNARCHIVE_CONFIRM_MESSAGE, })',
      ),
    );

    // Through the shared copy module, not a second spelling of it here.
    expect(HOOK_CODE).not.toContain('archiveConfirmMessage: "');
  });

  test("it returns both hooks' actions and mounts both modal trees", () => {
    /*
     * Returning one set is the failure that looks most like it works: four
     * buttons become two, and nothing says the other two are missing.
     */
    expect(HOOK_CODE).toContain(
      squash("bulkActions: [...labelBulkActions, ...ownerBulkActions],"),
    );

    const modals: string = HOOK_CODE.split("modals: (")[1]!.split("),")[0]!;

    expect(modals).toContain("{labelBulkActionModals}");
    expect(modals).toContain("{ownerBulkActionModals}");
  });

  test("archive and unarchive are handed back on their own, never folded into bulkActions", () => {
    /*
     * Which one a table offers depends on which list it is - the live list
     * archives, the Archived page unarchives, the monitor's tab does neither -
     * so folding either into `bulkActions` would put it on every table.
     */
    expect(HOOK_CODE).toContain(
      "archiveBulkActions: Array<BulkActionButtonSchema<ServiceLevelObjective>>;",
    );
    expect(HOOK_CODE).toContain(
      "unarchiveBulkActions: Array<BulkActionButtonSchema<ServiceLevelObjective>>;",
    );
    expect(HOOK_CODE).toContain(
      squash(
        "archiveBulkActions: archiveBulkActions, unarchiveBulkActions: unarchiveBulkActions,",
      ),
    );
  });
});

describe("the copy the SLO archive actions confirm with", () => {
  test("archiving says the SLOs stop being evaluated and their open outputs are resolved", () => {
    expect(SLO_BULK_ARCHIVE_CONFIRM_MESSAGE).toContain("not evaluated");
    expect(SLO_BULK_ARCHIVE_CONFIRM_MESSAGE).toContain("resolved");
    expect(SLO_BULK_ARCHIVE_CONFIRM_MESSAGE).toContain("Archived page");
  });

  test("unarchiving says evaluation resumes and a disabled SLO stays disabled", () => {
    expect(SLO_BULK_UNARCHIVE_CONFIRM_MESSAGE).toContain("evaluated again");
    expect(SLO_BULK_UNARCHIVE_CONFIRM_MESSAGE).toContain("stays disabled");
  });

  test("neither promises that telemetry keeps flowing", () => {
    expect(SLO_BULK_ARCHIVE_CONFIRM_MESSAGE).not.toContain("telemetry");
    expect(SLO_BULK_UNARCHIVE_CONFIRM_MESSAGE).not.toContain("telemetry");
  });
});

const OWNER_FIELD_DECLARATION: RegExpMatchArray | null = HOOK_CODE.match(
  /export const SLO_OWNER_RESOURCE_ID_FIELD: (\w+) = "([^"]+)";/,
);

type OwnerModel =
  | ServiceLevelObjectiveOwnerUser
  | ServiceLevelObjectiveOwnerTeam;

type OwnerModelCase = [string, OwnerModel];

const OWNER_MODEL_CASES: Array<OwnerModelCase> = [
  ["ServiceLevelObjectiveOwnerUser", new ServiceLevelObjectiveOwnerUser()],
  ["ServiceLevelObjectiveOwnerTeam", new ServiceLevelObjectiveOwnerTeam()],
];

/*
 * This is the assertion the whole file exists for. `resourceIdField` is a
 * string on the generic hook's config, so a wrong value there does not fail —
 * it filters on a column nothing matches, which comes back empty, so "Remove
 * Owner" reports every selected SLO as a success while removing nothing. The
 * constant is therefore parsed out of the source and checked against the two
 * models it names, rather than against another copy of itself.
 */
describe("SLO_OWNER_RESOURCE_ID_FIELD names a real column on both owner tables", () => {
  test("the module declares it as a literal, typed against both junction tables", () => {
    expect(OWNER_FIELD_DECLARATION).not.toBeNull();

    const annotation: string = OWNER_FIELD_DECLARATION![1]!;

    /*
     * The annotation is the compile-time half of the same guarantee: as the
     * intersection of both tables' keys, a typo stops being a value the hook
     * silently accepts and becomes a build error. Annotated `string` — which is
     * what it was — nothing but this test stands between a typo and shipping.
     */
    expect(HOOK_CODE).toContain(
      squash(
        `export type ${annotation} = keyof ServiceLevelObjectiveOwnerUser & keyof ServiceLevelObjectiveOwnerTeam;`,
      ),
    );

    expect(OWNER_FIELD_DECLARATION![2]).toBe("serviceLevelObjectiveId");
  });

  test.each(OWNER_MODEL_CASES)(
    "%s declares it, as the required foreign key",
    (_modelName: string, model: OwnerModel) => {
      const field: string = OWNER_FIELD_DECLARATION![2]!;

      expect(model.getTableColumns().columns).toContain(field);

      /*
       * Not merely present under that name: the hook writes an ObjectID into it
       * when creating a junction row, and a nullable column would accept a row
       * that points at no SLO at all.
       */
      const metadata: TableColumnMetadata = model.getTableColumnMetadata(field);

      expect(metadata.type).toBe(TableColumnType.ObjectID);
      expect(metadata.required).toBe(true);
    },
  );

  test("the label half has a column to write to as well", () => {
    /*
     * The same silent failure on the other hook — useBulkLabelActions merges
     * into `labels` by name, and a model without that column would take the
     * update and drop it.
     */
    expect(new ServiceLevelObjective().getTableColumns().columns).toContain(
      "labels",
    );
  });

  test("and the archive half has its column", () => {
    /*
     * useBulkArchiveActions writes `{ isArchived }` by name; on a model
     * without the column the update would be accepted and archive nothing.
     */
    expect(new ServiceLevelObjective().getTableColumns().columns).toContain(
      "isArchived",
    );
  });
});

describe("the SLOs page does not own the hook", () => {
  test("the hook, its key and its result type live in the shared module only", () => {
    /*
     * They were exported from this page first, and the monitor tab imported
     * them from here. Leaving a re-export behind is worse than either layout:
     * the two surfaces could then import the same names down two paths, and a
     * change made to one copy would look global while reaching one table.
     */
    const code: string = readCode(...SLOS_PAGE);

    expect(code).not.toContain("export const useSloBulkActions");
    expect(code).not.toContain("export const SLO_OWNER_RESOURCE_ID_FIELD");
    expect(code).not.toContain("export interface SloBulkActionsResult");
    expect(code).not.toContain('from "../../Slo/Slos"');
  });
});

// [label, path, import specifier, hook destructuring, buttons prop]
type ConsumerCase = [string, Array<string>, string, string, string];

const CONSUMER_CASES: Array<ConsumerCase> = [
  [
    "Pages/Slo/Slos.tsx",
    SLOS_PAGE,
    "../../Components/Slo/useSloBulkActions",
    "const { bulkActions, archiveBulkActions, modals }: SloBulkActionsResult = useSloBulkActions();",
    "bulkActions={{ buttons: [...bulkActions, ...archiveBulkActions], }}",
  ],
  [
    "Pages/Monitor/View/Slos.tsx",
    MONITOR_SLOS_PAGE,
    "../../../Components/Slo/useSloBulkActions",
    "const { bulkActions, modals }: SloBulkActionsResult = useSloBulkActions();",
    "bulkActions={{ buttons: [...bulkActions], }}",
  ],
];

describe("both live SLO tables consume the shared hook", () => {
  test.each(CONSUMER_CASES)(
    "%s calls it, passes the buttons, and renders the modals",
    (
      _label: string,
      relativeParts: Array<string>,
      specifier: string,
      destructuring: string,
      buttons: string,
    ) => {
      const code: string = readCode(...relativeParts);

      expect(code).toContain(
        squash(
          `import useSloBulkActions, { SLO_OWNER_RESOURCE_ID_FIELD, SloBulkActionsResult, } from "${specifier}";`,
        ),
      );
      expect(code).toContain(squash(destructuring));
      expect(code).toContain(squash(buttons));

      /*
       * A sibling of the table, not a child of it: ModelTable renders no
       * children, so a `{modals}` nested inside the element would be dropped
       * and every action button would open nothing.
       */
      expect(code).toContain("/> {modals}");

      /*
       * And through the shared hook rather than a local re-implementation,
       * which would satisfy every assertion above and still be a second thing
       * to keep in step with the first.
       */
      expect(code).not.toContain("useBulkLabelActions");
      expect(code).not.toContain("useBulkOwnerActions");
      expect(code).not.toContain("useBulkArchiveActions");
    },
  );

  test.each(CONSUMER_CASES)(
    "%s shows the owners its Add Owner action writes",
    (_label: string, relativeParts: Array<string>) => {
      const code: string = readCode(...relativeParts);

      /*
       * A bulk owner action on a table with no Owners column is indistinguishable
       * from a no-op: the progress modal closes and every row looks the same.
       * The column has to read through the SAME foreign key the action writes,
       * or the two disagree about which junction rows belong to which SLO.
       *
       * Checked as a prefix of the call: the SLOs list also hands the hook its
       * facet chips, which follow these three keys.
       */
      expect(code).toContain(
        squash(
          "useResourceOwners<ServiceLevelObjective>({ ownerUserModelType: ServiceLevelObjectiveOwnerUser, ownerTeamModelType: ServiceLevelObjectiveOwnerTeam, resourceIdField: SLO_OWNER_RESOURCE_ID_FIELD,",
        ),
      );
      expect(code).toContain(
        squash('title: "Owners", type: FieldType.Element,'),
      );
      expect(code).toContain(
        squash(
          "<OwnersCell owners={getOwnersForResource(item)} isLoading={isLoadingOwners} />",
        ),
      );

      /*
       * The owners are fetched in one query for the page of rows the table just
       * loaded, so the hook has to be handed that page. Without onFetchSuccess
       * it is never told any rows exist and every cell renders empty forever.
       * Checked as the first statement of the callback: the SLOs list also
       * refreshes its summary strip from there.
       */
      expect(code).toContain(
        squash(
          "onFetchSuccess={(data: Array<ServiceLevelObjective>) => { onResourcesFetched(data);",
        ),
      );
    },
  );
});

describe("each SLO table offers the archive action that fits its list", () => {
  test("the SLO list archives, and never offers Unarchive for rows that are all live", () => {
    const code: string = readCode(...SLOS_PAGE);

    expect(code).toMatch(ARCHIVE_ACTIONS_NAME);
    expect(code).not.toContain("unarchiveBulkActions");
  });

  test("the monitor's SLOs tab offers neither - an SLO is retired from the SLO list or its Settings", () => {
    const code: string = readCode(...MONITOR_SLOS_PAGE);

    expect(code).not.toMatch(ARCHIVE_ACTIONS_NAME);
    expect(code).not.toContain("unarchiveBulkActions");
  });

  test("the Archived page restores through the shared hook, and only restores", () => {
    const code: string = readCode(...ARCHIVED_SLOS_PAGE);

    expect(code).toContain(
      squash(
        'import useSloBulkActions, { SloBulkActionsResult, } from "../../Components/Slo/useSloBulkActions";',
      ),
    );
    expect(code).toContain(
      squash(
        "const { unarchiveBulkActions, modals }: SloBulkActionsResult = useSloBulkActions();",
      ),
    );
    expect(code).toContain(
      squash("bulkActions={{ buttons: [...unarchiveBulkActions], }}"),
    );
    expect(code).toContain("/> {modals}");
    expect(code).not.toMatch(ARCHIVE_ACTIONS_NAME);
    expect(code).not.toContain("useBulkArchiveActions");
  });
});

/*
 * "Add Labels" on a table with no Labels column is a no-op as far as the reader
 * can tell: the progress modal closes and the page looks exactly as it did. The
 * SLOs page already had the column; the monitor's SLOs tab had to grow one.
 */
describe("the monitor's SLOs tab shows the labels it can now edit", () => {
  const SOURCE: string = readSource(...MONITOR_SLOS_PAGE);

  test("renders a Labels column", () => {
    expect(SOURCE).toContain(
      'import LabelsElement from "Common/UI/Components/Label/Labels";',
    );
    expect(SOURCE).toContain(
      squash(
        'title: "Labels", type: FieldType.EntityArray, hideOnMobile: true,',
      ),
    );
    expect(SOURCE).toContain(
      squash('return <LabelsElement labels={item["labels"] || []} />;'),
    );
  });

  test("and asks the API for the fields that column renders", () => {
    /*
     * ModelTable builds its `select` out of the keys each column declares.
     * Naming only `labels: true` returns rows with no name and no colour, which
     * draws as a row of blank pills.
     */
    expect(SOURCE).toContain(
      squash(
        'field: { labels: { name: true, color: true, }, }, title: "Labels",',
      ),
    );
  });

  test("the column is added to the shared set rather than replacing it", () => {
    expect(SOURCE).toContain(squash("columns={[ ...getSloTableColumns(),"));
  });
});

/*
 * Everything above names the files by hand. This sweeps the dashboard for
 * ModelTables over ServiceLevelObjective instead, so the day another one is
 * added — an incident's SLOs tab, a team's — it fails here until it is wired.
 */

function findTsxFiles(directory: string): Array<string> {
  const found: Array<string> = [];

  const entries: Array<fs.Dirent> = fs.readdirSync(directory, {
    withFileTypes: true,
  });

  for (const entry of entries) {
    const fullPath: string = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      found.push(...findTsxFiles(fullPath));
    } else if (entry.name.endsWith(".tsx")) {
      found.push(fullPath);
    }
  }

  return found;
}

/*
 * ModelTable is always written with an explicit type argument, so the model a
 * table lists can be read off the opening tag with a regex — no JSX parsing,
 * and nothing that a prop's contents can throw off. The `\s*` absorbs prettier
 * wrapping the type argument onto its own line.
 */
const SLO_MODEL_TABLE: RegExp = /<ModelTable<\s*ServiceLevelObjective\s*>/;

const CALLS_SHARED_HOOK: RegExp = /useSloBulkActions\(\)/;
const PASSES_BULK_ACTIONS: RegExp = /bulkActions=\{\{/;
const MOUNTS_MODALS: RegExp = /\{modals\}/;

const SLO_TABLE_FILES: Array<string> = findTsxFiles(DASHBOARD_SRC)
  .filter((file: string): boolean => {
    return SLO_MODEL_TABLE.test(readRawAt(file));
  })
  .map((file: string): string => {
    return path.relative(DASHBOARD_SRC, file);
  })
  .sort();

describe("every ModelTable over ServiceLevelObjective offers the bulk actions", () => {
  test("each one calls the hook, passes the buttons and mounts the modals", () => {
    /*
     * A guard on the sweep itself: the checks below run per matched file, so a
     * pattern that quietly stopped matching would pass by examining nothing.
     * Named files rather than a count, because another table is meant to be
     * checked here, not rejected.
     */
    expect(SLO_TABLE_FILES).toContain(path.join("Pages", "Slo", "Slos.tsx"));
    expect(SLO_TABLE_FILES).toContain(
      path.join("Pages", "Slo", "Archived.tsx"),
    );
    expect(SLO_TABLE_FILES).toContain(
      path.join("Pages", "Monitor", "View", "Slos.tsx"),
    );

    const unwired: Array<string> = SLO_TABLE_FILES.filter(
      (relativePath: string): boolean => {
        const raw: string = readRawAt(path.join(DASHBOARD_SRC, relativePath));

        return (
          !CALLS_SHARED_HOOK.test(raw) ||
          !PASSES_BULK_ACTIONS.test(raw) ||
          !MOUNTS_MODALS.test(raw)
        );
      },
    );

    expect(unwired).toEqual([]);
  });

  test("none of them builds archive actions itself, so none can lose the SLO's archive copy", () => {
    const selfBuilt: Array<string> = SLO_TABLE_FILES.filter(
      (relativePath: string): boolean => {
        return readCodeAt(path.join(DASHBOARD_SRC, relativePath)).includes(
          "useBulkArchiveActions",
        );
      },
    );

    expect(selfBuilt).toEqual([]);
  });
});

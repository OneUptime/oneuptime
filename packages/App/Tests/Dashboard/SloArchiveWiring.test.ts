import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  getSloListBaseQuery,
  SLOS_TABLE_ID,
} from "../../FeatureSet/Dashboard/src/Components/Slo/SloStatusSummaryTiles";
import {
  SLO_ARCHIVE_CARD_DESCRIPTION,
  SLO_ARCHIVE_CONFIRM_MESSAGE,
  SLO_BULK_ARCHIVE_CONFIRM_MESSAGE,
  SLO_BULK_UNARCHIVE_CONFIRM_MESSAGE,
  SLO_UNARCHIVE_CARD_DESCRIPTION,
  SLO_UNARCHIVE_CONFIRM_MESSAGE,
} from "../../FeatureSet/Dashboard/src/Components/Slo/SloArchiveCopy";

/*
 * Archiving an SLO retires it: the worker stops evaluating it, and every
 * surface that lists, counts or offers SLOs has to stop showing it too - or a
 * retired SLO keeps turning up as "At Risk" on the Home page, in a monitor's
 * SLOs tab, in the delete warning for a monitor, and in the picker for a new
 * dashboard widget, with numbers frozen at the moment it was archived.
 *
 * Every one of those is a query written in a different file, and none of them
 * fails to compile or render when the filter is missing. So, as in
 * SloBulkActionsWiring.test.ts, these read the sources (comment-stripped and
 * whitespace-squashed) and pin the invariants: the live list and its summary
 * strip start from one base query that excludes archived SLOs, the Archived
 * page lists exactly the archived ones, and every other surface filters them.
 * The last sweep walks the dashboard, so a new SLO table must take a side.
 */

const DASHBOARD_SRC: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
);

function squash(text: string): string {
  return text.replace(/\s+/g, " ");
}

function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/.*$/gm, " ");
}

function readRawAt(absolutePath: string): string {
  return fs.readFileSync(absolutePath, "utf8");
}

function readCodeAt(absolutePath: string): string {
  return squash(stripComments(readRawAt(absolutePath)));
}

function readCode(...relativeParts: Array<string>): string {
  return readCodeAt(path.join(DASHBOARD_SRC, ...relativeParts));
}

// Squashed but NOT comment-stripped: for text inside template literals.
function readSource(...relativeParts: Array<string>): string {
  return squash(readRawAt(path.join(DASHBOARD_SRC, ...relativeParts)));
}

function between(text: string, start: string, end: string): string {
  const startIndex: number = text.indexOf(start);

  if (startIndex === -1) {
    throw new Error(`"${start}" not found`);
  }

  const endIndex: number = text.indexOf(end, startIndex + start.length);

  if (endIndex === -1) {
    throw new Error(`"${end}" not found after "${start}"`);
  }

  return text.slice(startIndex + start.length, endIndex);
}

const SLOS_CODE: string = readCode("Pages", "Slo", "Slos.tsx");
const ARCHIVED_CODE: string = readCode("Pages", "Slo", "Archived.tsx");

describe("the live SLO list leaves archived SLOs out", () => {
  test("its table query starts from the base query that excludes archived SLOs", () => {
    expect(getSloListBaseQuery()).toEqual({ isArchived: false });
    expect(SLOS_CODE).toContain(
      "query={mergeFiltersIntoQuery(getSloListBaseQuery())}",
    );
  });

  test("no popup filter can override that pin, or fight the Status and Enabled chips", () => {
    /*
     * BaseModelTable spreads column filters OVER the pinned query, so an
     * Archived filter here would pull archived rows back into the live list,
     * and a Status or Enabled filter would silently replace the chip that owns
     * that column while the chip stays lit.
     */
    const filters: string = between(SLOS_CODE, "filters={[", "]}");

    expect(filters).toContain('title: "Name"');
    expect(filters).not.toContain("isArchived");
    expect(filters).not.toContain("sloStatus");
    expect(filters).not.toContain("isEnabled");
  });

  test("the summary strip sits above the table and moves the same facet bar the table reads", () => {
    expect(SLOS_CODE.indexOf("<SloStatusSummaryCards")).toBeGreaterThan(-1);
    expect(SLOS_CODE.indexOf("<SloStatusSummaryCards")).toBeLessThan(
      SLOS_CODE.indexOf("<ModelTable<ServiceLevelObjective>"),
    );

    expect(SLOS_CODE).toContain(
      squash(
        "<SloStatusSummaryCards projectId={ProjectUtil.getCurrentProjectId()!} facetSelections={facetSelections} facetOperators={facetOperators} onTileClick={onSummaryTileClick} refreshToken={summaryRefreshCount.toString()} />",
      ),
    );
    expect(SLOS_CODE).toContain("applySloStatusSummaryTile({");
    expect(SLOS_CODE).toContain(
      squash("extraFacets: SLO_LIST_FACETS, persistKey: SLOS_TABLE_ID,"),
    );
    expect(SLOS_CODE).toContain("topContent={filterBar}");
    expect(SLOS_CODE).toContain("id={SLOS_TABLE_ID}");
    expect(SLOS_CODE).toContain("userPreferencesKey={SLOS_TABLE_ID}");
  });

  test("keeps the table id that users' saved preferences are stored under", () => {
    expect(SLOS_TABLE_ID).toBe("slos-table");
  });

  test("the strip counts from the tiles' own queries, scoped to the project", () => {
    const stripCode: string = readCode(
      "Components",
      "Slo",
      "SloStatusSummaryCards.tsx",
    );

    expect(stripCode).toContain(
      squash(
        "query: { ...getSloStatusSummaryTileQuery(tile), projectId: props.projectId, },",
      ),
    );
  });

  test("the strip recounts when the table refetches, but not twice on first load", () => {
    const onFetchSuccess: string = between(
      SLOS_CODE,
      "onFetchSuccess={(data: Array<ServiceLevelObjective>) => {",
      "isDeleteable={false}",
    );

    expect(onFetchSuccess).toContain(
      squash(
        "if (hasFetchedTableRef.current) { setSummaryRefreshCount((count: number): number => { return count + 1; }); }",
      ),
    );
    expect(onFetchSuccess).toContain("hasFetchedTableRef.current = true;");
  });

  test("the Status column reads Archived before Disabled before the measured status", () => {
    expect(SLOS_CODE).toContain(
      "const statusKind: SloListStatusKind = getSloListStatusKind(item);",
    );

    const archived: number = SLOS_CODE.indexOf(
      "if (statusKind === SloListStatusKind.Archived)",
    );
    const disabled: number = SLOS_CODE.indexOf(
      "if (statusKind === SloListStatusKind.Disabled)",
    );
    const measured: number = SLOS_CODE.indexOf(
      "<SloStatusPill status={item.sloStatus} />",
    );

    expect(archived).toBeGreaterThan(-1);
    expect(disabled).toBeGreaterThan(archived);
    expect(measured).toBeGreaterThan(disabled);
  });

  test("the columns those pills read are selected with every row", () => {
    const selectMoreFields: string = between(
      SLOS_CODE,
      "export const SLO_TABLE_SELECT_MORE_FIELDS: Select<ServiceLevelObjective> = {",
      "};",
    );

    expect(selectMoreFields).toContain("isArchived: true,");
    expect(selectMoreFields).toContain("isEnabled: true,");
  });

  test("a new SLO opens on its own page once it is created", () => {
    expect(SLOS_CODE).toContain(
      squash(
        "onCreateSuccess={( item: ServiceLevelObjective, modalType?: ModalType, ): Promise<ServiceLevelObjective> => { if (modalType === ModalType.Create && item._id) { Navigation.navigate(getSloViewRoute(item)); } return Promise.resolve(item); }}",
      ),
    );
  });

  test("the in-app help explains monitors, monitor rules, settings and archiving", () => {
    const source: string = readSource("Pages", "Slo", "Slos.tsx");

    expect(source).toContain("### Choosing What an SLO Measures");
    expect(source).toContain("**Monitor Rules**");
    expect(source).toContain("### SLO Settings");
    expect(source).toContain("### Archiving");
    expect(source).toContain("**Archived** page");
    expect(source).toContain("| **Disabled** |");
  });
});

describe("the Archived SLOs page", () => {
  test("lists only archived SLOs, and cannot create, edit or delete one in place", () => {
    expect(ARCHIVED_CODE).toContain(squash("query={{ isArchived: true, }}"));
    expect(ARCHIVED_CODE).toContain("isCreateable={false}");
    expect(ARCHIVED_CODE).toContain("isEditable={false}");
    expect(ARCHIVED_CODE).toContain("isDeleteable={false}");
    expect(ARCHIVED_CODE).toContain("isViewable={true}");
  });

  test("never shares saved preferences or URL filter state with the live list", () => {
    const declaration: RegExpMatchArray | null = ARCHIVED_CODE.match(
      /export const SLOS_ARCHIVED_TABLE_ID: string = "([^"]+)";/,
    );

    expect(declaration).not.toBeNull();
    expect(declaration![1]).toBe("slos-archived-table");
    expect(declaration![1]).not.toBe(SLOS_TABLE_ID);
    expect(ARCHIVED_CODE).toContain("id={SLOS_ARCHIVED_TABLE_ID}");
    expect(ARCHIVED_CODE).toContain(
      "userPreferencesKey={SLOS_ARCHIVED_TABLE_ID}",
    );
  });

  test("shows when each SLO was archived and by whom", () => {
    expect(ARCHIVED_CODE).toContain(
      squash(
        'field: { archivedAt: true, }, title: "Archived At", type: FieldType.DateTime,',
      ),
    );
    expect(ARCHIVED_CODE).toContain(
      squash(
        'field: { archivedByUser: { name: true, email: true, profilePictureId: true, }, }, title: "Archived By",',
      ),
    );
    expect(ARCHIVED_CODE).toContain(
      "<UserElement user={item.archivedByUser as User} />",
    );
  });

  test("shows what each SLO promised, but none of its frozen live numbers", () => {
    expect(ARCHIVED_CODE).toContain("...getSloTargetAndWindowColumns(),");
    expect(ARCHIVED_CODE).toContain("...getSloLastEvaluatedColumns(),");
    expect(ARCHIVED_CODE).not.toContain("getSloTableColumns()");
  });

  test("each row still opens the SLO", () => {
    expect(ARCHIVED_CODE).toContain(
      squash(
        "onViewPage={(item: ServiceLevelObjective): Promise<Route> => { return Promise.resolve(getSloViewRoute(item)); }}",
      ),
    );
  });

  test("is no longer a stub card", () => {
    expect(ARCHIVED_CODE).not.toContain("<Card");
  });

  test("is routed inside the list layout, linked from the side menu, and has its own breadcrumbs", () => {
    const routes: string = readCode("Routes", "SloRoutes.tsx");
    const sideMenu: string = readCode("Pages", "Slo", "SideMenu.tsx");
    const breadcrumbs: string = readCode(
      "Pages",
      "Slo",
      "Utils",
      "Breadcrumbs.ts",
    );

    expect(routes).toContain(
      'import SlosArchived from "../Pages/Slo/Archived";',
    );
    expect(routes).toContain(
      'path={SloRoutePath[PageMap.SLOS_ARCHIVED] || ""}',
    );
    expect(sideMenu).toContain("RouteMap[PageMap.SLOS_ARCHIVED] as Route");
    expect(sideMenu).toContain('title: "Archived",');
    expect(breadcrumbs).toContain("PageMap.SLOS_ARCHIVED");
    expect(breadcrumbs).toContain('"Archived"');
  });
});

describe("surfaces that count or offer SLOs leave archived ones out", () => {
  test("the Home page's 'SLOs at risk' tile does not count archived SLOs", () => {
    const sloCount: string = between(
      readCode("Components", "Home", "OverviewStats.tsx"),
      "ModelAPI.count<ServiceLevelObjective>({",
      "}),",
    );

    expect(sloCount).toContain("isEnabled: true,");
    expect(sloCount).toContain("isArchived: false,");
  });

  test("a monitor's delete warning names only the live SLOs it would change", () => {
    expect(readCode("Components", "Monitor", "SloImpactWarning.tsx")).toContain(
      squash(
        "monitors: new Includes([props.monitorId]), isArchived: false, },",
      ),
    );
  });

  test("a monitor's SLOs tab lists only live SLOs", () => {
    expect(readCode("Pages", "Monitor", "View", "Slos.tsx")).toContain(
      squash(
        "query={{ projectId: ProjectUtil.getCurrentProjectId()!, monitors: new Includes([modelId]), isArchived: false, }}",
      ),
    );
  });

  test("a dashboard's SLO picker offers only live SLOs, and still shows an archived one already chosen", () => {
    const dropdown: string = readCode(
      "Components",
      "Dashboard",
      "Canvas",
      "EntityFilterDropdown.tsx",
    );

    const sloCase: string = between(
      dropdown,
      "case EntityFilterModelType.ServiceLevelObjective:",
      "case EntityFilterModelType.Label:",
    );

    expect(sloCase).toContain(
      squash("pickableQuery: { isArchived: false } as Query<BaseModel>,"),
    );
    expect(sloCase).toContain('unpickableLabelSuffix: " (archived)",');

    // Only SLOs narrow what can be picked; every other entity type is as it was.
    expect(dropdown.split("pickableQuery: {").length - 1).toBe(1);

    expect(dropdown).toContain(
      squash(
        "query: { ...(def.pickableQuery || {}), projectId: projectId, } as Query<BaseModel>,",
      ),
    );
    expect(dropdown).toContain("_id: new Includes(");
  });
});

function findTsxFiles(directory: string): Array<string> {
  const found: Array<string> = [];

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const fullPath: string = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      found.push(...findTsxFiles(fullPath));
    } else if (entry.name.endsWith(".tsx")) {
      found.push(fullPath);
    }
  }

  return found;
}

const SLO_MODEL_TABLE: RegExp = /<ModelTable<\s*ServiceLevelObjective\s*>/;

describe("every ModelTable over ServiceLevelObjective takes a side on archived SLOs", () => {
  const sloTableFiles: Array<string> = findTsxFiles(DASHBOARD_SRC)
    .filter((file: string): boolean => {
      return SLO_MODEL_TABLE.test(readRawAt(file));
    })
    .map((file: string): string => {
      return path.relative(DASHBOARD_SRC, file);
    })
    .sort();

  test("the sweep finds the tables it is meant to check", () => {
    expect(sloTableFiles).toContain(path.join("Pages", "Slo", "Slos.tsx"));
    expect(sloTableFiles).toContain(path.join("Pages", "Slo", "Archived.tsx"));
    expect(sloTableFiles).toContain(
      path.join("Pages", "Monitor", "View", "Slos.tsx"),
    );
  });

  test("the Archived page pins archived SLOs in; every other table pins them out", () => {
    const unpinned: Array<string> = sloTableFiles.filter(
      (relativePath: string): boolean => {
        const code: string = readCodeAt(path.join(DASHBOARD_SRC, relativePath));

        if (relativePath === path.join("Pages", "Slo", "Archived.tsx")) {
          return !code.includes("isArchived: true");
        }

        return (
          !code.includes("isArchived: false") &&
          !code.includes("getSloListBaseQuery()")
        );
      },
    );

    expect(unpinned).toEqual([]);
  });
});

describe("the SLO archive copy", () => {
  const ALL_COPY: Array<string> = [
    SLO_ARCHIVE_CARD_DESCRIPTION,
    SLO_UNARCHIVE_CARD_DESCRIPTION,
    SLO_ARCHIVE_CONFIRM_MESSAGE,
    SLO_UNARCHIVE_CONFIRM_MESSAGE,
    SLO_BULK_ARCHIVE_CONFIRM_MESSAGE,
    SLO_BULK_UNARCHIVE_CONFIRM_MESSAGE,
  ];

  test("the Settings card describes archiving in the agreed words", () => {
    expect(SLO_ARCHIVE_CARD_DESCRIPTION).toBe(
      "Archived SLOs are hidden from the SLO list and are not evaluated. Open burn-rate alerts and incidents are resolved. You can unarchive at any time to resume measuring.",
    );
  });

  test("none of it promises that telemetry keeps flowing", () => {
    for (const copy of ALL_COPY) {
      expect(copy).not.toContain("telemetry");
    }
  });

  test("archiving copy says evaluation stops and open outputs are resolved", () => {
    for (const copy of [
      SLO_ARCHIVE_CARD_DESCRIPTION,
      SLO_ARCHIVE_CONFIRM_MESSAGE,
      SLO_BULK_ARCHIVE_CONFIRM_MESSAGE,
    ]) {
      expect(copy).toMatch(/evaluat/);
      expect(copy).toContain("resolved");
    }
  });

  test("unarchiving copy says a disabled SLO stays disabled", () => {
    expect(SLO_UNARCHIVE_CONFIRM_MESSAGE).toContain("stays disabled");
    expect(SLO_BULK_UNARCHIVE_CONFIRM_MESSAGE).toContain("stays disabled");
  });

  /*
   * The Settings page once kept its own copy of these strings, and the two
   * had already drifted: one promised evaluation "within a few minutes if it
   * is enabled", the other that a disabled SLO stays disabled.
   */
  test("the Settings card takes every string from this module instead of keeping its own", () => {
    const settings: string = readCode("Pages", "Slo", "View", "Settings.tsx");

    expect(settings).toContain(
      'from "../../../Components/Slo/SloArchiveCopy";',
    );
    expect(settings).toContain(
      "archiveCardDescription={SLO_ARCHIVE_CARD_DESCRIPTION}",
    );
    expect(settings).toContain(
      "unarchiveCardDescription={SLO_UNARCHIVE_CARD_DESCRIPTION}",
    );
    expect(settings).toContain(
      "archiveConfirmMessage={SLO_ARCHIVE_CONFIRM_MESSAGE}",
    );
    expect(settings).toContain(
      "unarchiveConfirmMessage={SLO_UNARCHIVE_CONFIRM_MESSAGE}",
    );
    expect(settings).not.toMatch(/const SLO_(UN)?ARCHIVE_/);
  });

  test("the Settings page re-reads its notice banner when the SLO is archived or unarchived", () => {
    expect(readCode("Pages", "Slo", "View", "Settings.tsx")).toContain(
      "onArchiveChange={refreshBanner}",
    );
  });
});

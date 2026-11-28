// UX rule: Docs/ux/README.md#lists
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import AllModelTypes from "../../../Models/DatabaseModels/Index";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import { getUniqueNameWhenRequiredColumn } from "../../../Types/Database/UniqueNameWhenRequired";
import { escapeRegExp } from "../../../Utils/RegExpEscape";

/*
 * EVERY LIST OF A KIND REQUIRE UNIQUE NAMES HOLDS MARKS ITS TWINS (#11021).
 *
 * Records that shared a name before a project required unique names keep
 * it, and two "API Health Check" rows read alike in a list. The shared list
 * marks them - "Same name as another monitor", with the day each was made -
 * for every kind a model marks @UniqueNameWhenRequired (ModelTable's
 * TwinMarks), so a kind marked tomorrow is marked in its list with no line
 * of its own. BaseModelTableTwinMarks renders that list for every such kind.
 *
 * What the shared list cannot reach, this guard does. It reads the
 * Dashboard's sources (and ee's, where they are checked out) and fails
 * when a kind the setting holds has no list that marks its twins:
 *
 *   - a list the shared table draws (ModelTable, BaseModelTable) of the
 *     kind, that shows the kind's name column - where the mark is drawn -
 *     marks its twins by itself;
 *   - a list drawn by hand (HAND_DRAWN_LISTS) marks them with the same
 *     hook, useTwinMarks: it reads the twins, draws each name through
 *     drawName and the note above the list;
 *   - a kind no Dashboard page lists says why (NO_LIST).
 *
 * A new kind marked @UniqueNameWhenRequired fails here until one of them
 * holds; an entry that no longer holds - a hand-drawn list that stopped
 * marking, a kind that gained a list, a kind no longer held - fails too.
 * The shared table's own wiring is pinned, so taking the marks out of it
 * is loud. The checks are pure functions over the sources, pinned on
 * small fixtures first.
 */

const REPOSITORY_ROOT: string = path.resolve(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "..",
);

const DASHBOARD_SOURCES: string = "packages/App/FeatureSet/Dashboard/src";

// ee's own pages; the Common Test job runs without them checked out.
const EE_SOURCES: string = "ee/Dashboard";

const BASE_MODEL_TABLE: string =
  "packages/Common/UI/Components/ModelTable/BaseModelTable.tsx";

/*
 * Lists drawn by hand, not by the shared table: each marks its kind's twins
 * with useTwinMarks itself.
 */
export const HAND_DRAWN_LISTS: Readonly<Record<string, string>> = {
  // One card per policy, from the page's own overview read.
  SecurityAutomaticResponsePolicy: `${DASHBOARD_SOURCES}/Pages/SecurityEvents/AutomaticResponse.tsx`,
  // Each Meraki connection with its status and its devices.
  NetworkControllerConnection: `${DASHBOARD_SOURCES}/Components/NetworkTraffic/Meraki/MerakiConnectionsCard.tsx`,
};

// Kinds no Dashboard page lists, and why.
export const NO_LIST: Readonly<Record<string, string>> = {
  AIAgent:
    "An AI agent is set up where it runs, and no Dashboard page lists agents: the Unique Names card says so where it names them.",
};

/*
 * Kinds whose only list is one of ee's pages: when ee is not checked out
 * (the Common Test job), the kind is held to the page named here instead.
 */
export const LISTED_IN_EE: Readonly<Record<string, string>> = {
  CustomRole: `${EE_SOURCES}/CustomRoles/RolesPage.tsx`,
  AuditLogExport: `${EE_SOURCES}/AuditLogExport/AuditLogExportTable.tsx`,
};

export interface HeldKind {
  tableName: string;
  // Its name column: "name", a template's "templateName".
  column: string;
}

export interface SourceFile {
  // From the repository's root.
  path: string;
  text: string;
}

export interface TwinMarkAudit {
  // Each kind's lists the shared table draws with its name column.
  sharedLists: Record<string, Array<string>>;
  // Kinds with no list that marks their twins, and no reason.
  unmarked: Array<string>;
  // Hand-drawn lists that do not mark their kind's twins.
  handDrawnNotMarking: Array<string>;
  // Entries that no longer say anything true.
  stale: Array<string>;
}

/*
 * Hoisted, as in TableFoldIntoGuard: wrap-regex and prettier disagree about
 * a regex literal a member expression reads.
 */
const SHARED_TABLE_TAG: RegExp = /<(?:Model|BaseModel)Table\b/;
const USES_TWIN_MARKS: RegExp = /\buseTwinMarks\(/;
const DRAWS_NAME: RegExp = /\.drawName\(/;
const DRAWS_NOTE: RegExp = /\.note\b/;
const READS_TWINS: RegExp = /\.onRowsRead\(/;
const SOURCE_FILE_NAME: RegExp = /\.tsx?$/;
const BLOCK_COMMENT: RegExp = /\/\*[\s\S]*?\*\//g;
const LINE_COMMENT: RegExp = /(^|[^:])\/\/[^\n]*/g;

export const stripComments: (text: string) => string = (
  text: string,
): string => {
  return text.replace(BLOCK_COMMENT, " ").replace(LINE_COMMENT, "$1");
};

// A list of the kind the shared table draws, in a file's code.
export const isSharedListOf: (text: string, kind: HeldKind) => boolean = (
  text: string,
  kind: HeldKind,
): boolean => {
  const code: string = stripComments(text);
  const tableName: string = escapeRegExp(kind.tableName);

  const drawsSharedTable: boolean =
    SHARED_TABLE_TAG.test(code) ||
    new RegExp(`\\b(?:Model|BaseModel)Table<${tableName}>`).test(code);

  const isOfKind: boolean = new RegExp(
    `modelType=\\{\\s*${tableName}\\s*\\}`,
  ).test(code);

  const showsName: boolean = new RegExp(
    `field:\\s*\\{\\s*${escapeRegExp(kind.column)}:\\s*true`,
  ).test(code);

  return drawsSharedTable && isOfKind && showsName;
};

// A list drawn by hand that marks the kind's twins with the shared hook.
export const isHandDrawnListMarking: (
  text: string,
  kind: HeldKind,
) => boolean = (text: string, kind: HeldKind): boolean => {
  const code: string = stripComments(text);

  return (
    USES_TWIN_MARKS.test(code) &&
    new RegExp(`modelType:\\s*${escapeRegExp(kind.tableName)}\\b`).test(code) &&
    DRAWS_NAME.test(code) &&
    DRAWS_NOTE.test(code) &&
    READS_TWINS.test(code)
  );
};

export const auditTwinMarks: (data: {
  kinds: ReadonlyArray<HeldKind>;
  sources: ReadonlyArray<SourceFile>;
  handDrawn: Readonly<Record<string, string>>;
  noList: Readonly<Record<string, string>>;
  listedInEe: Readonly<Record<string, string>>;
  isEeCheckedOut: boolean;
}) => TwinMarkAudit = (data: {
  kinds: ReadonlyArray<HeldKind>;
  sources: ReadonlyArray<SourceFile>;
  handDrawn: Readonly<Record<string, string>>;
  noList: Readonly<Record<string, string>>;
  listedInEe: Readonly<Record<string, string>>;
  isEeCheckedOut: boolean;
}): TwinMarkAudit => {
  const audit: TwinMarkAudit = {
    sharedLists: {},
    unmarked: [],
    handDrawnNotMarking: [],
    stale: [],
  };

  const heldTables: Set<string> = new Set<string>(
    data.kinds.map((kind: HeldKind): string => {
      return kind.tableName;
    }),
  );

  for (const kind of data.kinds) {
    const lists: Array<string> = data.sources
      .filter((source: SourceFile): boolean => {
        return isSharedListOf(source.text, kind);
      })
      .map((source: SourceFile): string => {
        return source.path;
      })
      .sort();

    audit.sharedLists[kind.tableName] = lists;

    const handDrawnPath: string | undefined = data.handDrawn[kind.tableName];

    if (handDrawnPath) {
      const source: SourceFile | undefined = data.sources.find(
        (file: SourceFile): boolean => {
          return file.path === handDrawnPath;
        },
      );

      if (!source) {
        audit.stale.push(
          `${kind.tableName}: its hand-drawn list ${handDrawnPath} is gone.`,
        );
      } else if (!isHandDrawnListMarking(source.text, kind)) {
        audit.handDrawnNotMarking.push(`${kind.tableName}: ${handDrawnPath}`);
      }
    }

    if (data.noList[kind.tableName] && lists.length > 0) {
      audit.stale.push(
        `${kind.tableName}: it has a list now (${lists.join(", ")}), which marks its twins; take it off NO_LIST.`,
      );
    }

    const isListedInEeOnly: boolean =
      !data.isEeCheckedOut && Boolean(data.listedInEe[kind.tableName]);

    if (
      lists.length === 0 &&
      !handDrawnPath &&
      !data.noList[kind.tableName] &&
      !isListedInEeOnly
    ) {
      audit.unmarked.push(kind.tableName);
    }
  }

  // Entries for kinds the setting no longer holds.
  for (const [entries, name] of [
    [data.handDrawn, "HAND_DRAWN_LISTS"],
    [data.noList, "NO_LIST"],
    [data.listedInEe, "LISTED_IN_EE"],
  ] as Array<[Readonly<Record<string, string>>, string]>) {
    for (const tableName of Object.keys(entries)) {
      if (!heldTables.has(tableName)) {
        audit.stale.push(
          `${tableName}: ${name} names a kind Require Unique Names does not hold.`,
        );
      }
    }
  }

  // With ee checked out, ee's lists are read: each named one marks.
  if (data.isEeCheckedOut) {
    for (const [tableName, listPath] of Object.entries(data.listedInEe)) {
      const kind: HeldKind | undefined = data.kinds.find((each: HeldKind) => {
        return each.tableName === tableName;
      });

      if (kind && !(audit.sharedLists[tableName] || []).includes(listPath)) {
        audit.stale.push(
          `${tableName}: ${listPath} is no list of it the shared table draws with its name.`,
        );
      }
    }
  }

  audit.unmarked.sort();

  return audit;
};

function sourceFiles(root: string): Array<SourceFile> {
  const absolute: string = path.join(REPOSITORY_ROOT, root);

  if (!fs.existsSync(absolute)) {
    return [];
  }

  const found: Array<SourceFile> = [];

  const walk: (directory: string) => void = (directory: string): void => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const full: string = path.join(directory, entry.name);

      if (entry.isDirectory()) {
        if (entry.name !== "node_modules" && entry.name !== "build") {
          walk(full);
        }
      } else if (SOURCE_FILE_NAME.test(entry.name)) {
        found.push({
          path: path.relative(REPOSITORY_ROOT, full).split(path.sep).join("/"),
          text: fs.readFileSync(full, "utf-8"),
        });
      }
    }
  };

  walk(absolute);

  return found;
}

const HELD_KINDS: Array<HeldKind> = AllModelTypes.map(
  (modelType: { new (): BaseModel }): HeldKind => {
    return {
      tableName: new modelType().tableName || "",
      column: getUniqueNameWhenRequiredColumn(modelType) || "",
    };
  },
)
  .filter((kind: HeldKind): boolean => {
    return Boolean(kind.column);
  })
  .sort((a: HeldKind, b: HeldKind): number => {
    return a.tableName.localeCompare(b.tableName);
  });

describe("the audit, on fixtures", () => {
  const MONITOR: HeldKind = { tableName: "Monitor", column: "name" };
  const TEMPLATE: HeldKind = {
    tableName: "IncidentTemplate",
    column: "templateName",
  };
  const POLICY: HeldKind = {
    tableName: "SecurityAutomaticResponsePolicy",
    column: "name",
  };

  const MONITOR_LIST: SourceFile = {
    path: "Monitors.tsx",
    text: `
      <ModelTable<Monitor>
        modelType={Monitor}
        columns={[{ field: { name: true }, title: "Name" }]}
      />`,
  };

  const MARKING_POLICIES: SourceFile = {
    path: "Policies.tsx",
    text: `
      const twinMarks = useTwinMarks({ modelType: SecurityAutomaticResponsePolicy });
      twinMarks.onRowsRead(policies);
      return <>{twinMarks.note}{twinMarks.drawName({ id, name })}</>;`,
  };

  const audit: (data: {
    kinds?: Array<HeldKind>;
    sources: Array<SourceFile>;
    handDrawn?: Record<string, string>;
    noList?: Record<string, string>;
    listedInEe?: Record<string, string>;
    isEeCheckedOut?: boolean;
  }) => TwinMarkAudit = (data: {
    kinds?: Array<HeldKind>;
    sources: Array<SourceFile>;
    handDrawn?: Record<string, string>;
    noList?: Record<string, string>;
    listedInEe?: Record<string, string>;
    isEeCheckedOut?: boolean;
  }): TwinMarkAudit => {
    return auditTwinMarks({
      kinds: data.kinds || [MONITOR],
      sources: data.sources,
      handDrawn: data.handDrawn || {},
      noList: data.noList || {},
      listedInEe: data.listedInEe || {},
      isEeCheckedOut: data.isEeCheckedOut ?? true,
    });
  };

  test("a list the shared table draws with the kind's name marks its twins", () => {
    expect(audit({ sources: [MONITOR_LIST] })).toEqual({
      sharedLists: { Monitor: ["Monitors.tsx"] },
      unmarked: [],
      handDrawnNotMarking: [],
      stale: [],
    });
  });

  test("a kind with no list that marks is reported: a new kind fails until it has one", () => {
    expect(audit({ sources: [] }).unmarked).toEqual(["Monitor"]);
  });

  test("a list without the kind's name column has nowhere to mark", () => {
    const withoutName: SourceFile = {
      path: "MonitorsById.tsx",
      text: `<ModelTable<Monitor> modelType={Monitor} columns={[{ field: { _id: true } }]} />`,
    };

    expect(audit({ sources: [withoutName] }).unmarked).toEqual(["Monitor"]);
  });

  test("a list of another kind, or one in a comment, is no list of this one", () => {
    const groups: SourceFile = {
      path: "Groups.tsx",
      text: `<ModelTable<MonitorGroup> modelType={MonitorGroup} columns={[{ field: { name: true } }]} />`,
    };
    const commented: SourceFile = {
      path: "Old.tsx",
      text: `/* <ModelTable modelType={Monitor} columns={[{ field: { name: true } }]} /> */`,
    };

    expect(audit({ sources: [groups, commented] }).unmarked).toEqual([
      "Monitor",
    ]);
  });

  test("a template is known by its templateName", () => {
    const templates: SourceFile = {
      path: "Templates.tsx",
      text: `<ModelTable<IncidentTemplate> modelType={IncidentTemplate} columns={[{ field: {
        templateName: true,
      } }]} />`,
    };

    expect(
      audit({ kinds: [TEMPLATE], sources: [templates] }).sharedLists,
    ).toEqual({ IncidentTemplate: ["Templates.tsx"] });
  });

  test("a hand-drawn list that marks with the shared hook marks; one that does not is reported", () => {
    expect(
      audit({
        kinds: [POLICY],
        sources: [MARKING_POLICIES],
        handDrawn: { SecurityAutomaticResponsePolicy: "Policies.tsx" },
      }),
    ).toEqual({
      sharedLists: { SecurityAutomaticResponsePolicy: [] },
      unmarked: [],
      handDrawnNotMarking: [],
      stale: [],
    });

    for (const without of [
      "useTwinMarks(",
      ".drawName(",
      ".note",
      ".onRowsRead(",
      "modelType: SecurityAutomaticResponsePolicy",
    ]) {
      expect({
        without,
        reported: audit({
          kinds: [POLICY],
          sources: [
            {
              path: "Policies.tsx",
              text: MARKING_POLICIES.text.split(without).join(" "),
            },
          ],
          handDrawn: { SecurityAutomaticResponsePolicy: "Policies.tsx" },
        }).handDrawnNotMarking,
      }).toEqual({
        without,
        reported: ["SecurityAutomaticResponsePolicy: Policies.tsx"],
      });
    }
  });

  test("a hand-drawn list that is gone is stale", () => {
    expect(
      audit({
        kinds: [POLICY],
        sources: [],
        handDrawn: { SecurityAutomaticResponsePolicy: "Policies.tsx" },
      }).stale,
    ).toEqual([
      "SecurityAutomaticResponsePolicy: its hand-drawn list Policies.tsx is gone.",
    ]);
  });

  test("a kind with no list says why; once it has one, the reason is stale", () => {
    expect(
      audit({ sources: [], noList: { Monitor: "No page lists them." } }),
    ).toEqual({
      sharedLists: { Monitor: [] },
      unmarked: [],
      handDrawnNotMarking: [],
      stale: [],
    });

    expect(
      audit({
        sources: [MONITOR_LIST],
        noList: { Monitor: "No page lists them." },
      }).stale,
    ).toEqual([
      "Monitor: it has a list now (Monitors.tsx), which marks its twins; take it off NO_LIST.",
    ]);
  });

  test("an entry for a kind the setting does not hold is stale", () => {
    expect(
      audit({
        sources: [MONITOR_LIST],
        handDrawn: { Team: "Teams.tsx" },
        noList: { Incident: "Events repeat their names." },
        listedInEe: { Label: "ee/Labels.tsx" },
      }).stale,
    ).toEqual([
      "Team: HAND_DRAWN_LISTS names a kind Require Unique Names does not hold.",
      "Incident: NO_LIST names a kind Require Unique Names does not hold.",
      "Label: LISTED_IN_EE names a kind Require Unique Names does not hold.",
    ]);
  });

  test("a kind listed only in ee is held to its page when ee is read, and to the entry when it is not", () => {
    const eeList: SourceFile = {
      path: "ee/Monitors.tsx",
      text: MONITOR_LIST.text,
    };

    // Read: the page is a list that marks.
    expect(
      audit({
        sources: [eeList],
        listedInEe: { Monitor: "ee/Monitors.tsx" },
      }),
    ).toEqual({
      sharedLists: { Monitor: ["ee/Monitors.tsx"] },
      unmarked: [],
      handDrawnNotMarking: [],
      stale: [],
    });

    // Read, and no longer a list that marks.
    expect(
      audit({
        sources: [{ path: "ee/Monitors.tsx", text: "<div />" }],
        listedInEe: { Monitor: "ee/Monitors.tsx" },
      }),
    ).toEqual({
      sharedLists: { Monitor: [] },
      unmarked: ["Monitor"],
      handDrawnNotMarking: [],
      stale: [
        "Monitor: ee/Monitors.tsx is no list of it the shared table draws with its name.",
      ],
    });

    // Not checked out: the entry stands for it.
    expect(
      audit({
        sources: [],
        listedInEe: { Monitor: "ee/Monitors.tsx" },
        isEeCheckedOut: false,
      }).unmarked,
    ).toEqual([]);
  });
});

describe("the Dashboard", () => {
  const isEeCheckedOut: boolean = fs.existsSync(
    path.join(REPOSITORY_ROOT, EE_SOURCES),
  );

  const sources: Array<SourceFile> = [
    ...sourceFiles(DASHBOARD_SOURCES),
    ...sourceFiles(EE_SOURCES),
  ];

  const audit: TwinMarkAudit = auditTwinMarks({
    kinds: HELD_KINDS,
    sources: sources,
    handDrawn: HAND_DRAWN_LISTS,
    noList: NO_LIST,
    listedInEe: LISTED_IN_EE,
    isEeCheckedOut: isEeCheckedOut,
  });

  test("its sources are read, and the setting holds dozens of kinds", () => {
    expect(sources.length).toBeGreaterThan(1000);
    expect(HELD_KINDS.length).toBeGreaterThan(40);
  });

  test("every kind Require Unique Names holds has a list that marks its twins, or says why it has none", () => {
    expect(audit.unmarked).toEqual([]);
  });

  test("every list drawn by hand marks its twins with the shared hook", () => {
    expect(audit.handDrawnNotMarking).toEqual([]);
  });

  test("no entry is stale", () => {
    expect(audit.stale).toEqual([]);
  });

  test("most kinds are marked by the shared table, without a line of their own", () => {
    const bySharedTable: Array<string> = Object.keys(audit.sharedLists).filter(
      (tableName: string): boolean => {
        return audit.sharedLists[tableName]!.length > 0;
      },
    );

    expect(bySharedTable.length).toBeGreaterThan(HELD_KINDS.length - 6);
    expect(bySharedTable).toEqual(
      expect.arrayContaining([
        "Monitor",
        "MonitorGroup",
        "ApiKey",
        "IncidentTemplate",
        "OpenStackBudget",
        "WorkspaceNotificationSummary",
      ]),
    );
  });

  test("a kind with no list has none: its reason holds", () => {
    for (const tableName of Object.keys(NO_LIST)) {
      expect({
        tableName,
        lists: audit.sharedLists[tableName],
        mentions: sources
          .filter((source: SourceFile): boolean => {
            return new RegExp(
              `modelType=\\{\\s*${escapeRegExp(tableName)}\\s*\\}`,
            ).test(stripComments(source.text));
          })
          .map((source: SourceFile): string => {
            return source.path;
          }),
      }).toEqual({ tableName, lists: [], mentions: [] });
    }
  });
});

describe("the shared table", () => {
  const code: string = stripComments(
    fs.readFileSync(path.join(REPOSITORY_ROOT, BASE_MODEL_TABLE), "utf-8"),
  );

  test("reads its kind's twins with its rows, marks its name column, and draws the note above its rows", () => {
    expect(code).toContain("useTwinMarks({");
    expect(code).toContain("twinMarks.onRowsRead(listResult.data");
    expect(code).toContain("markTwinsInColumn<TBaseModel>({");
    expect(code).toContain("{twinMarks.note}");
    // Keyed off the decorator, never a list of kinds.
    expect(code).toContain("getUniqueNameWhenRequiredColumn(model)");
  });
});

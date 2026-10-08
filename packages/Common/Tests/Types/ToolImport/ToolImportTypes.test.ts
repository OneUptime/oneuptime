import { describe, expect, test } from "@jest/globals";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";
import {
  getToolImportSourceDefinition,
  INCIDENT_IO_HOST,
  OPSGENIE_EU_HOST,
  OPSGENIE_US_HOST,
  resolveToolImportRegion,
  ToolImportCatalog,
  ToolImportRegion,
} from "../../../Types/ToolImport/ToolImportCatalog";
import {
  isToolImportNoteCode,
  makeToolImportNote,
  readToolImportNotes,
  ToolImportNoteCode,
} from "../../../Types/ToolImport/ToolImportNote";
import {
  countToolImportOutcomes,
  MAX_TOOL_IMPORT_SELECTED_KEYS,
  readToolImportReport,
  readToolImportSelection,
  ToolImportOutcome,
  ToolImportReport,
} from "../../../Types/ToolImport/ToolImportPlan";
import ToolImportResourceKind, {
  getToolImportItemKey,
  isToolImportResourceKind,
  ToolImportResourceKindOrder,
} from "../../../Types/ToolImport/ToolImportResourceKind";
import ToolImportRunStatus, {
  ActiveToolImportRunStatuses,
  FinishedToolImportRunStatuses,
  isActiveToolImportRunStatus,
  isToolImportRunStatus,
} from "../../../Types/ToolImport/ToolImportRunStatus";
import ToolImportSource, {
  AllToolImportSources,
  isToolImportSource,
} from "../../../Types/ToolImport/ToolImportSource";

/*
 * The shapes an import passes between the server, the worker and the page:
 * the catalog of tools (hosts and regions an import may call), notes, the
 * selection a start request sends (checked before anything uses it) and
 * the stored report (read back defensively).
 */

describe("ToolImportCatalog", () => {
  test("every tool has a definition with its own hosts, a docs page and what it brings", () => {
    for (const source of AllToolImportSources) {
      const definition: (typeof ToolImportCatalog)[ToolImportSource] =
        getToolImportSourceDefinition(source);

      expect(definition.source).toBe(source);
      expect(definition.title.length).toBeGreaterThan(0);
      expect(definition.hosts.length).toBeGreaterThan(0);
      expect(definition.docsPath).toMatch(/^\/docs\/moving-to-oneuptime\//);
      expect(definition.apiKeyDocsUrl.startsWith("https://")).toBe(true);
      expect(definition.kinds[0]).toBe(ToolImportResourceKind.Person);

      for (const region of definition.regions) {
        expect(definition.hosts).toContain(region.host);
      }
    }
  });

  test("Opsgenie is read from its US or EU host, picked by region, never typed", () => {
    expect(getToolImportSourceDefinition(ToolImportSource.OpsGenie).hosts).toEqual(
      [OPSGENIE_US_HOST, OPSGENIE_EU_HOST],
    );
    expect(
      resolveToolImportRegion(ToolImportSource.OpsGenie, undefined)?.host,
    ).toBe(OPSGENIE_US_HOST);
    expect(resolveToolImportRegion(ToolImportSource.OpsGenie, "EU")?.host).toBe(
      OPSGENIE_EU_HOST,
    );
    expect(
      resolveToolImportRegion(ToolImportSource.OpsGenie, "evil.example"),
    ).toBeNull();
    expect(
      resolveToolImportRegion(
        ToolImportSource.OpsGenie,
        "https://api.evil.example",
      ),
    ).toBeNull();
  });

  test("incident.io has one API, and no region may be named for it", () => {
    const region: ToolImportRegion | null = resolveToolImportRegion(
      ToolImportSource.IncidentIo,
      "",
    );

    expect(region?.host).toBe(INCIDENT_IO_HOST);
    expect(resolveToolImportRegion(ToolImportSource.IncidentIo, "EU")).toBeNull();
  });

  test("the key goes in each tool's documented header", () => {
    expect(
      getToolImportSourceDefinition(ToolImportSource.OpsGenie)
        .authorizationScheme,
    ).toBe("GenieKey");
    expect(
      getToolImportSourceDefinition(ToolImportSource.IncidentIo)
        .authorizationScheme,
    ).toBe("Bearer");
  });
});

describe("ToolImportSource, kinds and statuses", () => {
  test("only known values pass the guards", () => {
    expect(isToolImportSource("OpsGenie")).toBe(true);
    expect(isToolImportSource("IncidentIo")).toBe(true);
    expect(isToolImportSource("PagerDuty ")).toBe(false);
    expect(isToolImportSource(1)).toBe(false);

    expect(isToolImportResourceKind("OnCallSchedule")).toBe(true);
    expect(isToolImportResourceKind("Monitor")).toBe(false);

    expect(isToolImportRunStatus("Reading")).toBe(true);
    expect(isToolImportRunStatus("Done")).toBe(false);
  });

  test("every kind is created in a fixed order: people first, policies last", () => {
    expect(ToolImportResourceKindOrder[0]).toBe(ToolImportResourceKind.Person);
    expect(ToolImportResourceKindOrder[1]).toBe(ToolImportResourceKind.Team);
    expect(
      ToolImportResourceKindOrder[ToolImportResourceKindOrder.length - 1],
    ).toBe(ToolImportResourceKind.OnCallPolicy);
    expect(
      ToolImportResourceKindOrder.indexOf(ToolImportResourceKind.OnCallSchedule),
    ).toBeLessThan(
      ToolImportResourceKindOrder.indexOf(ToolImportResourceKind.OnCallPolicy),
    );
    expect(new Set(ToolImportResourceKindOrder).size).toBe(
      Object.values(ToolImportResourceKind).length,
    );
  });

  test("an item's key is its kind and the tool's id", () => {
    expect(getToolImportItemKey(ToolImportResourceKind.Team, "abc")).toBe(
      "Team:abc",
    );
  });

  test("a run is active while a worker reads or imports, and every other status is final but ReadyToReview", () => {
    expect(ActiveToolImportRunStatuses).toEqual([
      ToolImportRunStatus.Reading,
      ToolImportRunStatus.Importing,
    ]);
    expect(isActiveToolImportRunStatus(ToolImportRunStatus.Importing)).toBe(
      true,
    );
    expect(isActiveToolImportRunStatus(ToolImportRunStatus.ReadyToReview)).toBe(
      false,
    );
    expect(isActiveToolImportRunStatus(undefined)).toBe(false);

    const all: Set<string> = new Set<string>([
      ...ActiveToolImportRunStatuses,
      ...FinishedToolImportRunStatuses,
      ToolImportRunStatus.ReadyToReview,
    ]);

    expect(all.size).toBe(Object.values(ToolImportRunStatus).length);
  });
});

describe("ToolImportNote", () => {
  test("a note without values has none", () => {
    expect(makeToolImportNote(ToolImportNoteCode.NoPermission)).toEqual({
      code: ToolImportNoteCode.NoPermission,
    });
    expect(makeToolImportNote(ToolImportNoteCode.NoPermission, {})).toEqual({
      code: ToolImportNoteCode.NoPermission,
    });
  });

  test("stored notes are read back, dropping codes this build does not know and values that are not plain", () => {
    expect(
      readToolImportNotes([
        { code: "NeedsPlan", values: { plan: "Growth", extra: { a: 1 } } },
        { code: "SomethingNew", values: {} },
        "NeedsPlan",
        null,
        { code: "OverLimit", values: { limit: 500 } },
      ]),
    ).toEqual([
      { code: ToolImportNoteCode.NeedsPlan, values: { plan: "Growth" } },
      { code: ToolImportNoteCode.OverLimit, values: { limit: 500 } },
    ]);
    expect(readToolImportNotes("not a list")).toEqual([]);
    expect(isToolImportNoteCode("PersonNoEmail")).toBe(true);
    expect(isToolImportNoteCode("personnoemail")).toBe(false);
  });
});

describe("readToolImportSelection: what a start request may send", () => {
  const TEAM_ID: string = ObjectID.generate().toString();

  test("keys of known kinds, without repeats, and a team id", () => {
    expect(
      readToolImportSelection({
        selectedKeys: ["Person:a", "Team:b", "Person:a"],
        inviteTeamId: TEAM_ID,
      }),
    ).toEqual({ selectedKeys: ["Person:a", "Team:b"], inviteTeamId: TEAM_ID });
  });

  test("no team invites nobody", () => {
    for (const inviteTeamId of [undefined, null, ""]) {
      expect(
        readToolImportSelection({ selectedKeys: [], inviteTeamId: inviteTeamId })
          .inviteTeamId,
      ).toBeNull();
    }
  });

  test.each([
    [null],
    [[]],
    ["Person:a"],
    [{}],
    [{ selectedKeys: "Person:a" }],
    [{ selectedKeys: [1] }],
    [{ selectedKeys: ["Monitor:a"] }],
    [{ selectedKeys: ["Person:"] }],
    [{ selectedKeys: ["Person"] }],
    [{ selectedKeys: ["x".repeat(700)] }],
    [{ selectedKeys: [], inviteTeamId: "not-an-id" }],
    [{ selectedKeys: [], inviteTeamId: 7 }],
  ] as Array<[unknown]>)("refuses %j", (value: unknown) => {
    expect(() => {
      return readToolImportSelection(value);
    }).toThrow(BadDataException);
  });

  test("refuses more keys than an import could ever have", () => {
    const keys: Array<string> = [];

    for (let index: number = 0; index <= MAX_TOOL_IMPORT_SELECTED_KEYS; index++) {
      keys.push(`Person:${index}`);
    }

    expect(() => {
      return readToolImportSelection({ selectedKeys: keys });
    }).toThrow("Too many items were chosen.");
  });
});

describe("readToolImportReport: a stored report, read back", () => {
  const RECORD_ID: string = ObjectID.generate().toString();

  test("well-formed items are kept, with their reason, notes and error", () => {
    const report: ToolImportReport = readToolImportReport({
      items: [
        {
          key: "Team:a",
          kind: "Team",
          sourceId: "a",
          name: "Platform",
          outcome: "Created",
          recordIds: [RECORD_ID, "not-an-id"],
          notes: [{ code: "PersonLeftOut", values: { name: "x@y.z" } }],
        },
        {
          key: "Person:b",
          kind: "Person",
          sourceId: "b",
          name: "Bob",
          outcome: "Failed",
          recordIds: [],
          reason: { code: "NoPermission" },
          notes: [],
          error: "You do not have permission",
        },
      ],
    });

    expect(report.items).toEqual([
      {
        key: "Team:a",
        kind: ToolImportResourceKind.Team,
        sourceId: "a",
        name: "Platform",
        outcome: ToolImportOutcome.Created,
        recordIds: [RECORD_ID],
        notes: [
          {
            code: ToolImportNoteCode.PersonLeftOut,
            values: { name: "x@y.z" },
          },
        ],
      },
      {
        key: "Person:b",
        kind: ToolImportResourceKind.Person,
        sourceId: "b",
        name: "Bob",
        outcome: ToolImportOutcome.Failed,
        recordIds: [],
        reason: { code: ToolImportNoteCode.NoPermission },
        notes: [],
        error: "You do not have permission",
      },
    ]);
  });

  test("anything this build does not understand is dropped", () => {
    expect(
      readToolImportReport({
        items: [
          { key: "Monitor:a", kind: "Monitor", sourceId: "a", name: "x", outcome: "Created" },
          { key: "Team:a", kind: "Team", sourceId: "a", name: "x", outcome: "Exploded" },
          "nonsense",
        ],
      }).items,
    ).toEqual([]);
    expect(readToolImportReport(null).items).toEqual([]);
    expect(readToolImportReport({ items: "x" }).items).toEqual([]);
  });

  test("outcomes are counted, every outcome present", () => {
    const counts: Record<ToolImportOutcome, number> = countToolImportOutcomes({
      items: [
        {
          key: "Team:a",
          kind: ToolImportResourceKind.Team,
          sourceId: "a",
          name: "A",
          outcome: ToolImportOutcome.Created,
          recordIds: [],
          notes: [],
        },
        {
          key: "Team:b",
          kind: ToolImportResourceKind.Team,
          sourceId: "b",
          name: "B",
          outcome: ToolImportOutcome.Created,
          recordIds: [],
          notes: [],
        },
        {
          key: "Person:c",
          kind: ToolImportResourceKind.Person,
          sourceId: "c",
          name: "C",
          outcome: ToolImportOutcome.Skipped,
          recordIds: [],
          notes: [],
        },
      ],
    });

    expect(counts).toEqual({
      Created: 2,
      Invited: 0,
      Matched: 0,
      AlreadyImported: 0,
      Skipped: 1,
      Failed: 0,
    });
    expect(countToolImportOutcomes(null).Created).toBe(0);
  });
});

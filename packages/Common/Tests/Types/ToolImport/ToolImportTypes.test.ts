import { describe, expect, test } from "@jest/globals";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";
import {
  getToolImportSourceDefinition,
  GRAFANA_ONCALL_API_URL_EXAMPLE,
  INCIDENT_IO_HOST,
  isToolImportAddressGiven,
  isToolImportFileUpload,
  OPSGENIE_EU_HOST,
  OPSGENIE_US_HOST,
  PAGERDUTY_EU_HOST,
  PAGERDUTY_US_HOST,
  resolveToolImportRegion,
  SPLUNK_ON_CALL_HOST,
  ToolImportCatalog,
  ToolImportCategory,
  ToolImportCredentialField,
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
      expect(definition.docsPath).toMatch(/^\/docs\/moving-to-oneuptime\//);
      expect(definition.apiKeyDocsUrl.startsWith("https://")).toBe(true);

      /*
       * People come first for a tool that pages a team; monitors first for
       * an uptime or status page tool.
       */
      expect(definition.kinds[0]).toBe(
        definition.category === ToolImportCategory.OnCall
          ? ToolImportResourceKind.Person
          : ToolImportResourceKind.Monitor,
      );

      /*
       * A tool read from a file the person uploads calls nothing: no
       * hosts, no regions, nothing asked for but the file.
       */
      if (isToolImportFileUpload(definition)) {
        expect(definition.hosts).toEqual([]);
        expect(definition.regions).toEqual([]);
        expect(definition.credentialFields).toEqual([]);
        expect(definition.authorizationScheme).toBe("None");
        expect(definition.fileUpload?.accept).toContain(".json");
        continue;
      }

      /*
       * Fixed hosts, or - for a tool people also run themselves - none,
       * and the address the person gives, with an example of it.
       */
      if (isToolImportAddressGiven(definition)) {
        expect(definition.hosts).toEqual([]);
        expect(definition.regions).toEqual([]);
        expect(definition.apiUrlExample?.startsWith("https://")).toBe(true);
      } else {
        expect(definition.hosts.length).toBeGreaterThan(0);
        expect(definition.apiUrlExample).toBeUndefined();
      }

      for (const region of definition.regions) {
        expect(definition.hosts).toContain(region.host);
      }

      // The key is always asked for, once, and last.
      expect(
        definition.credentialFields.filter(
          (field: ToolImportCredentialField): boolean => {
            return field === ToolImportCredentialField.ApiKey;
          },
        ),
      ).toHaveLength(1);
      expect(
        definition.credentialFields[definition.credentialFields.length - 1],
      ).toBe(ToolImportCredentialField.ApiKey);
    }
  });

  test("no two tools share a host, so a read of one can never call another", () => {
    const hosts: Array<string> = AllToolImportSources.flatMap(
      (source: ToolImportSource): Array<string> => {
        return getToolImportSourceDefinition(source).hosts;
      },
    );

    expect(new Set(hosts).size).toBe(hosts.length);
  });

  test("the picker offers Opsgenie first, as it is being retired, then the tools teams most often leave", () => {
    expect(AllToolImportSources).toEqual([
      ToolImportSource.OpsGenie,
      ToolImportSource.PagerDuty,
      ToolImportSource.IncidentIo,
      ToolImportSource.SplunkOnCall,
      ToolImportSource.GrafanaOnCall,
      ToolImportSource.UptimeRobot,
      ToolImportSource.AtlassianStatuspage,
      ToolImportSource.BetterStack,
      ToolImportSource.Pingdom,
      ToolImportSource.StatusCake,
      ToolImportSource.UptimeKuma,
    ]);
  });

  test("the on-call tools come first and the uptime and status page tools after them, each group together", () => {
    const categories: Array<ToolImportCategory> = AllToolImportSources.map(
      (source: ToolImportSource): ToolImportCategory => {
        return getToolImportSourceDefinition(source).category;
      },
    );
    const firstMonitoring: number = categories.indexOf(
      ToolImportCategory.Monitoring,
    );

    expect(firstMonitoring).toBeGreaterThan(0);
    expect(
      categories
        .slice(0, firstMonitoring)
        .every((category: ToolImportCategory): boolean => {
          return category === ToolImportCategory.OnCall;
        }),
    ).toBe(true);
    expect(
      categories
        .slice(firstMonitoring)
        .every((category: ToolImportCategory): boolean => {
          return category === ToolImportCategory.Monitoring;
        }),
    ).toBe(true);
  });

  test("PagerDuty is read from its US or EU host, picked by region, with its version header", () => {
    const definition: (typeof ToolImportCatalog)[ToolImportSource] =
      getToolImportSourceDefinition(ToolImportSource.PagerDuty);

    expect(definition.hosts).toEqual([PAGERDUTY_US_HOST, PAGERDUTY_EU_HOST]);
    expect(PAGERDUTY_US_HOST).toBe("api.pagerduty.com");
    expect(PAGERDUTY_EU_HOST).toBe("api.eu.pagerduty.com");
    expect(
      resolveToolImportRegion(ToolImportSource.PagerDuty, undefined)?.host,
    ).toBe(PAGERDUTY_US_HOST);
    expect(
      resolveToolImportRegion(ToolImportSource.PagerDuty, "EU")?.host,
    ).toBe(PAGERDUTY_EU_HOST);
    expect(
      resolveToolImportRegion(ToolImportSource.PagerDuty, "api.evil.example"),
    ).toBeNull();
    expect(definition.authorizationScheme).toBe("TokenToken");
    expect(definition.headers).toEqual({
      Accept: "application/vnd.pagerduty+json;version=2",
    });
    expect(definition.credentialFields).toEqual([
      ToolImportCredentialField.ApiKey,
    ]);
    expect(definition.kinds).toEqual([
      ToolImportResourceKind.Person,
      ToolImportResourceKind.Team,
      ToolImportResourceKind.OnCallSchedule,
      ToolImportResourceKind.OnCallPolicy,
      ToolImportResourceKind.Service,
    ]);
  });

  test("Splunk On-Call has one API, and asks for the API ID with the key, at its documented pace", () => {
    const definition: (typeof ToolImportCatalog)[ToolImportSource] =
      getToolImportSourceDefinition(ToolImportSource.SplunkOnCall);

    expect(definition.hosts).toEqual([SPLUNK_ON_CALL_HOST]);
    expect(SPLUNK_ON_CALL_HOST).toBe("api.victorops.com");
    expect(
      resolveToolImportRegion(ToolImportSource.SplunkOnCall, "")?.host,
    ).toBe(SPLUNK_ON_CALL_HOST);
    expect(
      resolveToolImportRegion(ToolImportSource.SplunkOnCall, "EU"),
    ).toBeNull();
    expect(definition.authorizationScheme).toBe("ApiIdAndKey");
    expect(definition.credentialFields).toEqual([
      ToolImportCredentialField.ApiKeyId,
      ToolImportCredentialField.ApiKey,
    ]);
    // Each endpoint answers at most twice a second.
    expect(definition.minRequestIntervalMs).toBeGreaterThanOrEqual(500);
    expect(definition.kinds).not.toContain(ToolImportResourceKind.Service);
  });

  test("Grafana OnCall is read at the address the person gives, never a fixed host, one request a second", () => {
    const definition: (typeof ToolImportCatalog)[ToolImportSource] =
      getToolImportSourceDefinition(ToolImportSource.GrafanaOnCall);

    expect(isToolImportAddressGiven(definition)).toBe(true);
    expect(definition.hosts).toEqual([]);
    expect(definition.apiUrlExample).toBe(GRAFANA_ONCALL_API_URL_EXAMPLE);
    expect(definition.credentialFields).toEqual([
      ToolImportCredentialField.ApiUrl,
      ToolImportCredentialField.ApiKey,
    ]);
    expect(definition.authorizationScheme).toBe("Plain");
    // 300 requests a token in five minutes on a self-hosted install.
    expect(definition.minRequestIntervalMs).toBeGreaterThanOrEqual(1000);
    expect(
      resolveToolImportRegion(
        ToolImportSource.GrafanaOnCall,
        "https://oncall.example.com",
      ),
    ).toBeNull();

    for (const source of AllToolImportSources) {
      expect({
        source,
        isAddressGiven: isToolImportAddressGiven(
          getToolImportSourceDefinition(source),
        ),
      }).toEqual({
        source,
        isAddressGiven: source === ToolImportSource.GrafanaOnCall,
      });
    }
  });

  test("Opsgenie is read from its US or EU host, picked by region, never typed", () => {
    expect(
      getToolImportSourceDefinition(ToolImportSource.OpsGenie).hosts,
    ).toEqual([OPSGENIE_US_HOST, OPSGENIE_EU_HOST]);
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
    expect(
      resolveToolImportRegion(ToolImportSource.IncidentIo, "EU"),
    ).toBeNull();
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
    expect(
      getToolImportSourceDefinition(ToolImportSource.PagerDuty)
        .authorizationScheme,
    ).toBe("TokenToken");
    expect(
      getToolImportSourceDefinition(ToolImportSource.SplunkOnCall)
        .authorizationScheme,
    ).toBe("ApiIdAndKey");
    expect(
      getToolImportSourceDefinition(ToolImportSource.GrafanaOnCall)
        .authorizationScheme,
    ).toBe("Plain");
  });
});

describe("ToolImportSource, kinds and statuses", () => {
  test("only known values pass the guards", () => {
    expect(isToolImportSource("OpsGenie")).toBe(true);
    expect(isToolImportSource("IncidentIo")).toBe(true);
    expect(isToolImportSource("PagerDuty")).toBe(true);
    expect(isToolImportSource("SplunkOnCall")).toBe(true);
    expect(isToolImportSource("GrafanaOnCall")).toBe(true);
    expect(isToolImportSource("PagerDuty ")).toBe(false);
    expect(isToolImportSource("VictorOps")).toBe(false);
    expect(isToolImportSource(1)).toBe(false);

    expect(isToolImportResourceKind("OnCallSchedule")).toBe(true);
    expect(isToolImportResourceKind("Monitor")).toBe(true);
    expect(isToolImportResourceKind("StatusPageSubscriber")).toBe(true);
    expect(isToolImportResourceKind("Incident")).toBe(false);

    expect(isToolImportRunStatus("Reading")).toBe(true);
    expect(isToolImportRunStatus("Done")).toBe(false);
  });

  test("every kind is created in a fixed order: people first, policies after the schedules they page, then monitors, the status pages that show them and their subscribers", () => {
    expect(ToolImportResourceKindOrder[0]).toBe(ToolImportResourceKind.Person);
    expect(ToolImportResourceKindOrder[1]).toBe(ToolImportResourceKind.Team);
    expect(ToolImportResourceKindOrder.slice(-4)).toEqual([
      ToolImportResourceKind.OnCallPolicy,
      ToolImportResourceKind.Monitor,
      ToolImportResourceKind.StatusPage,
      ToolImportResourceKind.StatusPageSubscriber,
    ]);
    expect(
      ToolImportResourceKindOrder.indexOf(
        ToolImportResourceKind.OnCallSchedule,
      ),
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
        readToolImportSelection({
          selectedKeys: [],
          inviteTeamId: inviteTeamId,
        }).inviteTeamId,
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
    [{ selectedKeys: ["Widget:a"] }],
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

    for (
      let index: number = 0;
      index <= MAX_TOOL_IMPORT_SELECTED_KEYS;
      index++
    ) {
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
          {
            key: "Widget:a",
            kind: "Widget",
            sourceId: "a",
            name: "x",
            outcome: "Created",
          },
          {
            key: "Team:a",
            kind: "Team",
            sourceId: "a",
            name: "x",
            outcome: "Exploded",
          },
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
